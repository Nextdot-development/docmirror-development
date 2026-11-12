'use strict';

require('../lib/env');

const cashfree    = require('../lib/payments/cashfree');
const { resolveRegion } = require('../lib/region');
const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { verifyAuditCacheTable } = require('../lib/supabase-client');
const { optionalAuth } = require('../lib/auth-middleware');

// Extract user from Bearer token if present (never blocks the request) —
// same pattern as routes/checkout.js.
async function getOptionalUser(req) {
  return new Promise(resolve => {
    req._optResolve = resolve;
    optionalAuth(req, {}, () => resolve(req.user || null));
  });
}

// USD one-time report checkout via Cashfree — anonymous (no account before
// payment), mirroring the Razorpay /api/checkout flow. Amount + currency come
// only from lib/pricing.js (inside cashfree.createOrder); the client never
// supplies them. The row we store here is what /verify + /webhook compare
// against, so if we cannot store it we refuse the payment.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, auditData, phone, plan = 'report' } = req.body || {};
  if (!email)     return res.status(400).json({ error: 'email is required' });
  if (!auditData) return res.status(400).json({ error: 'auditData is required' });

  if (!process.env.CASHFREE_API_BASE || !process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
    return res.status(500).json({ error: 'Cashfree not configured (CASHFREE_API_BASE / CASHFREE_APP_ID / CASHFREE_SECRET_KEY)' });
  }

  const user   = await getOptionalUser(req);
  const userId = user?.id || null;

  try {
    const tableCheck = await verifyAuditCacheTable();
    if (!tableCheck.ok) {
      console.error('[cashfree-create] audit_cache not ready:', tableCheck.message);
      return res.status(503).json({
        error: 'Audit storage temporarily unavailable. Please try again in a moment.',
        code:  tableCheck.code || 'TABLE_INACCESSIBLE',
      });
    }

    const auditId = `tdm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const cached  = await auditCache.set(auditId, auditData);
    console.log(`[cashfree-create] audit cached auditId=${auditId} doctor=${cached.doctorName || '(unknown)'}`);

    // Region drives price + currency. resolveRegion honours an explicit
    // body/query region override (the checkout currency toggle) over geo.
    const region = resolveRegion(req);
    const tier   = region.tier;

    // Amount + currency are resolved from pricing INSIDE createOrder — server-side only.
    const order = await cashfree.createOrder({
      plan,
      region:   tier,
      customer: { email, phone, auditId },
    });

    // Persist the create-time row (provider order id + amount + currency) that
    // /verify and /webhook check against. Must succeed — otherwise we would let
    // the customer pay an order we cannot later verify.
    const stored = await paidReports.insertCashfreeOrder({
      auditId,
      email,
      providerOrderId: order.providerOrderId,
      currency:        order.currency,
      amount:          order.amount,
      paymentStatus:   order.raw?.order_status || 'ACTIVE',
      regionTier:      tier,
      country:         region.country || null,
      userId,
    });
    if (!stored.ok) {
      const msg = stored.reason === 'schema_not_migrated'
        ? 'Payments schema not migrated - apply database/migrations/017_cashfree_payments.sql.'
        : 'Could not record the order before payment. Please retry.';
      console.error(`[cashfree-create] order row NOT stored order=${order.providerOrderId} reason=${stored.reason || 'unknown'}`);
      return res.status(503).json({ error: msg, code: stored.reason || 'ORDER_NOT_STORED' });
    }

    console.log(
      `[cashfree-create] order=${order.providerOrderId} region=${tier} country=${region.country || '?'} ` +
      `amount=${order.amount} ${order.currency} auditId=${auditId}`
    );

    return res.json({
      provider:        'cashfree',
      sessionId:       order.sessionId,       // opened by the Cashfree JS SDK
      providerOrderId: order.providerOrderId, // returned to /verify after payment
      amount:          order.amount,
      currency:        order.currency,
      region:          tier,
      auditId,
      doctorName:      auditData.doctorName || '',
    });

  } catch (err) {
    if (err.name === 'AuditCacheError') {
      console.error(`[cashfree-create] audit_cache error code=${err.code}:`, err.message);
      return res.status(503).json({ error: 'Could not save audit data before payment. Please retry.', code: err.code });
    }
    console.error('[cashfree-create] error:', err.message);
    return res.status(500).json({ error: 'Checkout failed: ' + err.message });
  }
}

module.exports = handler;
