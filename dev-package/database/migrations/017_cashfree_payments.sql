-- Migration 017: Cashfree payment tracking on paid_reports
-- Supersedes the never-deployed 016 for paid_reports. Additive + idempotent
-- (ADD COLUMN IF NOT EXISTS), so it is safe on the live base schema. Does NOT
-- touch the existing report-pipeline `status` column or its CHECK constraint.
--
-- Cashfree (USD, US/INTL) one-time orders are stored here alongside Razorpay
-- (INR) orders. The row written at create time is what the verify route compares
-- against (provider order id + amount + currency), so a client cannot tamper
-- with the charged amount.

-- Which provider owns this order row. Existing rows are all Razorpay.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS provider          TEXT NOT NULL DEFAULT 'razorpay';
-- Cashfree order_id (our tdm_… id). Razorpay rows continue to use stripe_session_id.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
-- Charge currency shown == charged (USD for Cashfree, INR for Razorpay).
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS currency          TEXT;
-- Charged amount in MAJOR units (e.g. 19.00 USD, 1828.00 INR) — matches what
-- Cashfree returns, so the verify-time tamper check is a direct equality.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS amount            NUMERIC(12,2);
-- Cashfree order lifecycle (ACTIVE/PAID/EXPIRED/…). Separate from the report
-- pipeline `status` column above to avoid clobbering its CHECK constraint.
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS payment_status    TEXT;
-- Region attribution (folds in the useful bits of the retired 016).
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS region_tier       TEXT;
ALTER TABLE paid_reports ADD COLUMN IF NOT EXISTS country           TEXT;

-- Webhook idempotency + verify lookups key on the Cashfree order id.
CREATE INDEX IF NOT EXISTS idx_paid_reports_provider_order_id ON paid_reports(provider_order_id);

NOTIFY pgrst, 'reload schema';
