#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   BLOCKING PROBE — does this Cashfree account accept USD orders?

   Creates two sandbox orders via POST {CASHFREE_API_BASE}/orders:
     a) INR 999
     b) USD 29
   Everything else about the two requests is identical, so the ONLY variable is
   order_currency — an isolated test of account-level USD support. Prints the
   HTTP status + full response body for each. Errors are not swallowed.

   No integration code is written until USD is confirmed accepted.
   Run:  node scripts/probe-cashfree.js
   ────────────────────────────────────────────────────────────────────────── */

require('../lib/env'); // loads config/.env.local

const API_BASE = process.env.CASHFREE_API_BASE;
const APP_ID   = process.env.CASHFREE_APP_ID;
const SECRET   = process.env.CASHFREE_SECRET_KEY;
const APP_BASE = process.env.APP_BASE_URL || 'https://thedocmirror.com';
const API_VERSION = '2023-08-01';

// Credential presence only — never print the values.
console.log('── Cashfree probe config ──');
console.log('CASHFREE_ENV      :', process.env.CASHFREE_ENV || '(unset)');
console.log('CASHFREE_API_BASE :', API_BASE || '(unset)');
console.log('APP_BASE_URL      :', APP_BASE);
console.log('x-api-version     :', API_VERSION);
console.log('app_id present    :', Boolean(APP_ID));
console.log('secret present    :', Boolean(SECRET));
console.log('');

if (!API_BASE || !APP_ID || !SECRET) {
  console.error('✗ Missing CASHFREE_API_BASE / CASHFREE_APP_ID / CASHFREE_SECRET_KEY in env — cannot probe.');
  process.exit(1);
}

// Minimal-but-valid order body. Same customer for both so currency is the only
// difference. customer_phone uses a 10-digit number Cashfree sandbox accepts, so
// a phone-validation error can't be mistaken for a currency rejection.
function orderBody(currency, amount, tag) {
  return {
    order_amount:   amount,
    order_currency: currency,
    customer_details: {
      customer_id:    `probe_${tag}`,
      customer_phone: '9999999999',
      customer_email: 'probe@thedocmirror.com',
    },
    order_meta: {
      return_url: `${APP_BASE}/api/payments/cashfree/verify?order_id={order_id}`,
      notify_url: `${APP_BASE}/api/payments/cashfree/webhook`,
    },
    order_note: `probe ${currency} ${amount}`,
  };
}

async function createOrder(label, currency, amount, tag) {
  console.log(`── ${label}: order_currency=${currency} order_amount=${amount} ──`);
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-version':   API_VERSION,
      'x-client-id':     APP_ID,
      'x-client-secret': SECRET,
    },
    body: JSON.stringify(orderBody(currency, amount, tag)),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log('HTTP status :', res.status, res.statusText);
  console.log('Response    :', typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  console.log('');
  return { status: res.status, body };
}

(async () => {
  // a) INR baseline — proves the credentials + request shape work at all.
  await createOrder('a) INR baseline', 'INR', 999, 'inr');
  // b) USD — the actual question.
  await createOrder('b) USD international', 'USD', 29, 'usd');
})().catch(err => {
  console.error('✗ PROBE ERROR (not swallowed):', err && err.stack ? err.stack : err);
  process.exit(2);
});
