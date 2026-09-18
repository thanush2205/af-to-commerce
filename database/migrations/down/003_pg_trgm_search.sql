-- Rollback migration 003 (typo-tolerant search / pg_trgm).
BEGIN;

DROP INDEX IF EXISTS idx_products_description_trgm;
DROP INDEX IF EXISTS idx_products_name_trgm;

-- Only safe to drop when nothing else relies on it; the demo owns the schema.
DROP EXTENSION IF EXISTS pg_trgm;

COMMIT;
