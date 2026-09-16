-- =============================================================================
-- Migration 001: Affiliate Commerce catalog schema
--
-- Source of truth for all product data scraped from the Summerhill Market
-- catalog. Elasticsearch is maintained as a derived search index; this schema
-- is canonical.
--
-- Design
-- ------
--   categories 1 ─── N subcategories
--   subcategories 1 ─── N products
--   products 1 ─── N product_images
--
-- Idempotency
-- -----------
-- Every object here is guarded with IF [NOT] EXISTS so the migration is safe
-- to re-apply (docker-entrypoint-initdb.d runs it once per empty data dir, but
-- a re-run must never fail or drop existing data).
--
-- Upsert support (used by the Dagster ingestion pipeline)
-- -------------------------------------------------------
-- Natural keys are enforced with named unique constraints so upstream loaders
-- can use INSERT ... ON CONFLICT ON CONSTRAINT ... safely:
--   * categories.slug
--   * subcategories (category_id, slug)
--   * products.sku, products.slug
--   * product_images (product_id, image_url)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id         BIGSERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    slug       TEXT NOT NULL,
    image_url  TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT categories_slug_key UNIQUE (slug)
);

-- -----------------------------------------------------------------------------
-- subcategories
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subcategories (
    id          BIGSERIAL PRIMARY KEY,
    category_id BIGINT NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subcategories_category_slug_key UNIQUE (category_id, slug)
);

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id                 BIGSERIAL PRIMARY KEY,
    name               TEXT NOT NULL,
    slug               TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    description_source TEXT NOT NULL DEFAULT 'none',
    price              NUMERIC(12, 2) NOT NULL,
    currency           TEXT NOT NULL DEFAULT 'CAD',
    sku                TEXT NOT NULL,
    availability       TEXT NOT NULL DEFAULT 'in_stock',
    brand              TEXT,
    organic            BOOLEAN NOT NULL DEFAULT false,
    unit               TEXT,
    unit_quantity      NUMERIC(10, 3),
    min_quantity       NUMERIC(10, 3) NOT NULL DEFAULT 0,
    max_quantity       NUMERIC(10, 3) NOT NULL DEFAULT 0,
    main_image         TEXT,
    thumbnail          TEXT,
    is_active          BOOLEAN NOT NULL DEFAULT true,
    category_id        BIGINT NOT NULL REFERENCES categories (id),
    subcategory_id     BIGINT NOT NULL REFERENCES subcategories (id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT products_sku_key UNIQUE (sku),
    CONSTRAINT products_slug_key UNIQUE (slug),
    CONSTRAINT products_currency_len_check CHECK (char_length(currency) = 3),
    CONSTRAINT products_availability_check CHECK (
        availability IN ('in_stock', 'out_of_stock', 'unavailable')
    ),
    CONSTRAINT products_price_non_negative_check CHECK (price >= 0)
);

-- -----------------------------------------------------------------------------
-- product_images
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_images (
    id         BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    image_url  TEXT NOT NULL,
    position   SMALLINT NOT NULL DEFAULT 0,
    kind       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT product_images_product_url_key UNIQUE (product_id, image_url),
    CONSTRAINT product_images_position_non_negative_check CHECK (position >= 0)
);

-- -----------------------------------------------------------------------------
-- Indexes for frequently queried paths
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_category        ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_subcategory     ON products (subcategory_id);
CREATE INDEX IF NOT EXISTS idx_products_price           ON products (price);
CREATE INDEX IF NOT EXISTS idx_products_availability    ON products (availability);
CREATE INDEX IF NOT EXISTS idx_products_category_price  ON products (category_id, price);
CREATE INDEX IF NOT EXISTS idx_subcategories_category   ON subcategories (category_id);
CREATE INDEX IF NOT EXISTS idx_product_images_product   ON product_images (product_id);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_categories_updated_at    ON categories;
DROP TRIGGER IF EXISTS trg_subcategories_updated_at ON subcategories;
DROP TRIGGER IF EXISTS trg_products_updated_at      ON products;

CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_subcategories_updated_at
    BEFORE UPDATE ON subcategories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;