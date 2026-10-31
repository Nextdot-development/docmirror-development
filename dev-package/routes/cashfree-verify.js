'use strict';

require('../lib/env');

const cashfree    = require('../lib/payments/cashfree');
const auditCache  = require('../lib/audit-cache');
const paidReports = require('../lib/paid-reports');
const { afterResponse } = require('../lib/after-response');

// Statuses that mean another path already owns this order (a pipeline is in
// flight or the report is done). Mirrors the Razorpay webhook guard.
const OWNED = new Set(['generating', 'delivered', 'generated']);

// GET /api/payments/cashfree/verify?order_id=...
// Called after Cashfree redirects back. Verifies the payment SERVER-SIDE and,
// crucially, checks THREE things against the row stored at create time:
//   order_status === 'PAID'  AND  amount matches  AND  currency matches.
// Any mismatch is rejected (tamper protection). On success the code path
// converges on the SAME runReportPipeline call the Razorpay flow uses.
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const orderId = req.query.order_id || req.query.orderId;
  if (!orderId) return res.status(400).json({ ok: false, error: 'order_id is required' });

  // 1. The row we stored at create time — our source of truth for amount/currency.
  const row = await paidReports.getByProviderOrderId(orderId);
  if (!row)                         return res.status(404).json({ ok: false, error: 'Unknown order' });
  if (row.provider !== 'cashfree')  return res.status(400).json({ ok: false, error: 'Not a Cashfree order' });

  // 2. Fetch the order from Cashfree server-side (never trust the client).
  let cf;
  try {
    cf = await cashfree.verifyOrder(orderId);
  } catch (e) {
    console.error(`[cashfree-verify] fetch error order=${orderId}: ${e.message}`);
    return res.status(502).json({ ok: false, error: 'Could not verify payment with Cashfree' });
  }

  // 3. THREE-way check against the stored row.
  if (cf.status !== 'PAID') {
    console.log(`[cashfree-verify] order=${orderId} not paid (status=${cf.status}) — no report`);
    return res.json({ ok: true, paid: false, status: cf.status });
  }
  const amountMatch   = Number(cf.amount) === Number(row.amount);
  const currencyMatch = String(cf.currency) === String(row.currency);
  if (!amountMatch || !currencyMatch) {
    console.error(
      `[cashfree-verify] TAMPER order=${orderId} PAID but mismatch: ` +
      `cashfree=${cf.amount} ${cf.currency} stored=${row.amount} ${row.currency}`
    );
    await paidReports.updateByProviderOrderId(orderId, { payment_status: 'MISMATCH' }).catch(() => {});
    return res.status(400).json({ ok: false, paid: true, error: 'Payment amount/currency mismatch — not accepted' });
  }

  const auditId = row.audit_id;

  // 4. Idempotency — never re-drive an order already generating/delivered.
  if (row.delivered_at || OWNED.has(row.status)) {
    console.log(`[cashfree-verify] order=${orderId} auditId=${auditId} already status=${row.status} — no-op`);
    return res.json({ ok: true, paid: true, generating: true, auditId, message: 'Payment verified — your report is already being generated.' });
  }

  // 5. Mark paid + generating, confirm audit data is present.
  await paidReports.updateByProviderOrderId(orderId, { payment_status: 'PAID', status: 'generating' }).catch(() => {});
  const cache = await auditCache.getDetailed(auditId);
  if (!cache.hit || !cache.data) {
    console.error(`[cashfree-verify] audit_cache MISS auditId=${auditId}`);
    return res.status(503).json({ ok: false, error: 'Payment verified but audit data unavailable. Support can re-trigger.', auditId });
  }

  // 6. Converge on the SAME pipeline as Razorpay — no provider-specific branching after this.
  const { runReportPipeline } = require('./report');
  afterResponse(() => runReportPipeline({ auditId, email: row.email, userId: null }), `cashfree-report:${auditId}`);

  console.log(`[cashfree-verify] verified ✓ order=${orderId} auditId=${auditId} ${cf.amount} ${cf.currency}`);
  return res.json({
    ok:         true,
    paid:       true,
    generating: true,
    auditId,
    message:    'Payment verified! Your report is being generated — the PDF will be emailed shortly.',
  });
}

module.exports = handler;
