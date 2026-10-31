'use strict';

require('../lib/env');

const cashfree    = require('../lib/payments/cashfree');
const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { afterResponse } = require('../lib/after-response');

// Same idempotency guard as the Razorpay webhook + verify path.
const OWNED = new Set(['generating', 'delivered', 'generated']);

// POST /api/payments/cashfree/webhook — registered with express.raw() so the
// body is the untouched bytes the signature was computed over.
//
// Backstop for /verify: if the customer closes the tab right after paying, this
// (signature-verified) webhook runs the SAME idempotent pipeline. It re-fetches
// the order server-side rather than trusting the webhook body, and is guarded on
// order_id so a Cashfree retry of the same event never double-generates.
async function handler(req, res) {
  const rawBody = req.body; // Buffer — express.raw()

  // 1. Verify signature on the RAW body (base64 HMAC-SHA256 of timestamp+rawBody).
  if (!cashfree.verifyWebhook(rawBody, req.headers)) {
    console.error('[cashfree-webhook] signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 2. Parse.
  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const orderId = event?.data?.order?.order_id || null;
  const type    = event?.type || '';
  console.log(`[cashfree-webhook] type=${type} order=${orderId || '(none)'}`);

  if (!orderId) return res.json({ received: true });

  try {
    const row = await paidReports.getByProviderOrderId(orderId);
    if (!row) {
      console.log(`[cashfree-webhook] order=${orderId} not found — skip`);
      return res.json({ received: true });
    }

    // 3. Idempotency — another path already owns this order.
    if (row.delivered_at || OWNED.has(row.status)) {
      console.log(`[cashfree-webhook] order=${orderId} already status=${row.status} — no-op`);
      return res.json({ received: true });
    }

    // 4. Re-verify server-side (never trust the webhook body's amount/status).
    const cf = await cashfree.verifyOrder(orderId);
    if (cf.status !== 'PAID' || Number(cf.amount) !== Number(row.amount) || String(cf.currency) !== String(row.currency)) {
      console.warn(
        `[cashfree-webhook] order=${orderId} not cleanly PAID/matching ` +
        `(status=${cf.status} cf=${cf.amount} ${cf.currency} stored=${row.amount} ${row.currency}) — skip`
      );
      return res.json({ received: true });
    }

    const auditId = row.audit_id;
    const cache   = await auditCache.getDetailed(auditId);
    if (!cache.hit || !cache.data) {
      console.warn(`[cashfree-webhook] order=${orderId} auditId=${auditId} audit_cache MISS — cannot generate`);
      return res.json({ received: true });
    }

    await paidReports.updateByProviderOrderId(orderId, { payment_status: 'PAID', status: 'generating' }).catch(() => {});
    console.log(`[cashfree-webhook] backstop → generating order=${orderId} auditId=${auditId}`);

    const { runReportPipeline } = require('./report');
    afterResponse(() => runReportPipeline({ auditId, email: row.email, userId: null }), `cashfree-webhook:${auditId}`);

    return res.json({ received: true });

  } catch (err) {
    console.error('[cashfree-webhook] processing error:', err.message);
    // 200 so Cashfree does not hammer retries on our internal errors.
    return res.json({ received: true, warning: err.message });
  }
}

module.exports = handler;
