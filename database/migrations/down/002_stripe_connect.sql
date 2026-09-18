-- Rollback migration 002 (Stripe Connect / merchants / orders).
BEGIN;

DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
ALTER TABLE products DROP COLUMN IF EXISTS merchant_id;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS merchants;

COMMIT;