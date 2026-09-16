-- =============================================================================
-- Migration 001 down: rollback the catalog schema
--
-- Drops in reverse dependency order: product_images, products, subcategories,
-- categories, then the shared updated_at trigger function.
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_products_updated_at      ON products;
DROP TRIGGER IF EXISTS trg_subcategories_updated_at ON subcategories;
DROP TRIGGER IF EXISTS trg_categories_updated_at    ON categories;

DROP FUNCTION IF EXISTS set_updated_at();

DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS subcategories;
DROP TABLE IF EXISTS categories;

COMMIT;