'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Cashfree International Payment Gateway provider.
//
// Handles USD (US/INTL) traffic: Cashfree charges in USD and settles in INR, so
// DISPLAY currency finally equals CHARGE currency — fixing the US-card 3DS
// failures Razorpay/INR caused. Razorpay stays the provider for Indian (INR)
// traffic and is NOT touched by this module.
//
// Interface (per the task spec — note it differs from razorpay.js on purpose;
// Cashfree gets its own dedicated routes in routes/payments/cashfree/*, so the
// two providers are not called polymorphically):
//   createOrder({ plan, region, customer })  -> { providerOrderId, sessionId }
//   verifyOrder(providerOrderId)             -> { paid, amount, currency, raw }
//   verifyWebhook(rawBody, headers)          -> boolean
//   createSubscription(...)                  -> TODO (one-time purchase first)
//
// SECURITY: amount + currency come ONLY from lib/pricing.js, keyed by region +
// plan, server-side. A client-supplied amount is never trusted. verifyOrder
// re-fetches the order from Cashfree; the route compares status + amount +
// currency against the row we stored at create time (tamper protection).
//
// UNITS: pricing stores MINOR units (paise/cents); Cashfree's order_amount is in
// MAJOR units (₹/$). We convert amount/100 here.
//
// PROBE NOTES (scripts/probe-cashfree.js, sandbox, 2026-08-04):
//   • USD order creation returns order_status ACTIVE + payment_session_id — the
//     account accepts USD at the order API level.
//   • customer_phone '9999999999' (10-digit) was accepted for BOTH INR and USD.
//     A '+1…' E.164 number was NOT tested, so E.164 acceptance is UNVERIFIED.
//     We pass the caller's phone through unchanged; collect a real phone at
//     checkout. The 10-digit fallback below is only a last resort.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
require('../env'); // loads config/.env.local
const pricing = require('../pricing');

const name = 'cashfree';

const API_BASE    = () => process.env.CASHFREE_API_BASE;      // e.g. https://sandbox.cashfree.com/pg
const APP_ID      = () => process.env.CASHFREE_APP_ID;
const SECRET      = () => process.env.CASHFREE_SECRET_KEY;
const APP_BASE    = () => process.env.APP_BASE_URL || 'https://www.thedocmirror.com';
const API_VERSION = '2023-08-01';

// Probe-proven placeholder ONLY when the checkout supplies no phone. Cashfree
// mandates customer_phone; a real number should always be collected upstream.
const PHONE_FALLBACK = '9999999999';

// ── low-level Cashfree call (never swallows errors, never logs secrets) ───────
async function cashfreeFetch(method, path, body) {
  const base = API_BASE();
  if (!base || !APP_ID() || !SECRET()) {
    throw new Error('Cashfree not configured (CASHFREE_API_BASE / CASHFREE_APP_ID / CASHFREE_SECRET_KEY)');
  }
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type':    'application/json',
      'x-api-version':   API_VERSION,
      'x-client-id':     APP_ID(),
      'x-client-secret': SECRET(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) {
    const msg = (parsed && parsed.message) ? parsed.message : (typeof parsed === 'string' ? parsed : 'unknown error');
    const err = new Error(`Cashfree ${method} ${path} → ${res.status}: ${msg}`);
    err.status = res.status;
    err.body   = parsed;
    throw err; // do not swallow
  }
  return parsed;
}

// pricing (minor units) → Cashfree order_amount (major units, 2dp).
function toMajor(minorUnits) {
  return Number((minorUnits / 100).toFixed(2));
}

// ── createOrder ──────────────────────────────────────────────────────────────
// plan   = pricing product key ('report' | 'monitor')
// region = pricing tier ('IN' | 'US' | 'INTL') — normally US/INTL for Cashfree
// customer = { id?, email?, phone?, auditId? }
async function createOrder({ plan, region, customer = {} }) {
  // Authoritative price — server-side, never from the client.
  const price    = pricing.priceFor(region, plan);
  const amount   = toMajor(price.amount);
  const currency = price.currency;

  // Our own order_id (also the providerOrderId we persist + verify against). The
  // auditId is carried in order_tags so it survives the round trip to the return
  // page / webhook even though it is not part of the id.
  const orderId = `tdm_${plan}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  const payload = {
    order_id:       orderId,
    order_amount:   amount,
    order_currency: currency,
    customer_details: {
      customer_id:    customer.id || orderId,
      customer_phone: customer.phone || PHONE_FALLBACK,
      ...(customer.email ? { customer_email: customer.email } : {}),
    },
    order_meta: {
      // {order_id} is substituted by Cashfree on redirect.
      return_url: `${APP_BASE()}/api/payments/cashfree/verify?order_id={order_id}`,
      notify_url: `${APP_BASE()}/api/payments/cashfree/webhook`,
    },
    order_tags: {
      auditId: customer.auditId || '',
      plan:    String(plan),
      region:  String(region),
    },
  };

  const res = await cashfreeFetch('POST', '/orders', payload);
  return {
    providerOrderId: res.order_id,           // our id, echoed back
    sessionId:       res.payment_session_id, // opened by the Cashfree JS SDK
    // extras the route persists at create time for the tamper check later:
    amount:          amount,
    currency:        currency,
    raw:             res,
  };
}

// ── verifyOrder ──────────────────────────────────────────────────────────────
// Server-side fetch of the order. Returns the raw facts; the ROUTE compares
// status + amount + currency against the stored row (tamper protection).
async function verifyOrder(providerOrderId) {
  const res = await cashfreeFetch('GET', `/orders/${encodeURIComponent(providerOrderId)}`);
  return {
    paid:     res.order_status === 'PAID',
    amount:   res.order_amount,
    currency: res.order_currency,
    status:   res.order_status,
    raw:      res,
  };
}

// ── verifyWebhook ────────────────────────────────────────────────────────────
// Cashfree signs webhooks as base64( HMAC-SHA256( timestamp + rawBody, secret) ).
// Compare against x-webhook-signature with a constant-time check. rawBody MUST be
// the untouched request body (route disables the JSON parser for the webhook).
function verifyWebhook(rawBody, headers = {}) {
  const ts  = headers['x-webhook-timestamp'];
  const sig = headers['x-webhook-signature'];
  const secret = SECRET();
  if (!ts || !sig || !secret) return false;

  const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(ts + raw).digest('base64');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length) return false;      // timingSafeEqual requires equal length
  return crypto.timingSafeEqual(a, b);
}

// ── createSubscription (TODO) ────────────────────────────────────────────────
// TODO: implement Cashfree recurring/subscriptions once one-time USD is live and
// international recurring on USD cards is confirmed for this account (the probe
// only covered one-time orders). Throw until then so nothing silently no-ops.
async function createSubscription() {
  throw new Error('cashfree.createSubscription not implemented yet — one-time USD purchase ships first (TODO)');
}

module.exports = {
  name,
  createOrder,
  verifyOrder,
  verifyWebhook,
  createSubscription,
  // exported for unit tests / reuse:
  toMajor,
};
