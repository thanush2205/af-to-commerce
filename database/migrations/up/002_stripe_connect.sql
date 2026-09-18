-- =============================================================================
-- Migration 002: Stripe Connect merchants
--
-- Stage 4 (Stripe Connect): the platform (main Stripe account) onboards
-- merchants as Custom Connected Accounts. Connected account IDs are stored
-- here and linked to products so checkout can route funds to a merchant.
--
-- https://stripe.com/docs/connect/custom-accounts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- merchants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
    id                 BIGSERIAL PRIMARY KEY,
    name               TEXT NOT NULL,
    email              TEXT NOT NULL,
    -- The Stripe Custom Connected Account id (acct_...). NULL until onboarded.
    stripe_account_id  TEXT,
    -- Denormalized operational state for the demo/status-simulation flows.
    -- `verified` / `failed` / `restricted` map to simulated account states.
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'verified', 'failed', 'restricted')),
    status_reason      TEXT,
    capabilities       TEXT[] NOT NULL DEFAULT '{card_payments,transfers}',
    payout_schedule    TEXT  NOT NULL DEFAULT 'manual',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT merchants_stripe_account_key UNIQUE (stripe_account_id)
);

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants (status);

-- -----------------------------------------------------------------------------
-- products -> merchant link (a product belongs to one merchant; the platform
-- holds products without a merchant as its own inventory).
-- -----------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id BIGINT REFERENCES merchants (id);

CREATE INDEX IF NOT EXISTS idx_products_merchant ON products (merchant_id);

-- -----------------------------------------------------------------------------
-- orders: authoritative record written from the Stripe webhook.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                 BIGSERIAL PRIMARY KEY,
    stripe_session_id  TEXT NOT NULL,
    stripe_payment_intent_id TEXT,
    merchant_id        BIGINT REFERENCES merchants (id),
    amount_total       NUMERIC(12, 2) NOT NULL,
    amount_platform    NUMERIC(12, 2) NOT NULL,
    amount_merchant    NUMERIC(12, 2) NOT NULL,
    currency           TEXT NOT NULL DEFAULT 'CAD',
    status             TEXT NOT NULL DEFAULT 'paid'
                       CHECK (status IN ('paid', 'refunded', 'failed')),
    skus               JSONB NOT NULL DEFAULT '[]',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orders_session_key UNIQUE (stripe_session_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_merchant ON orders (merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON orders (created_at);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_merchants_updated_at ON merchants;
CREATE TRIGGER trg_merchants_updated_at
    BEFORE UPDATE ON merchants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;