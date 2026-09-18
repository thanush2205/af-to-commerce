-- =============================================================================
-- Migration 003: typo-tolerant product search (pg_trgm)
--
-- The storefront search runs against Elasticsearch when configured, but the
-- PostgreSQL fallback must behave sensibly on its own. Plain `ILIKE '%term%'`
-- cannot handle typos ("landry" -> "laundry"), so this enables the pg_trgm
-- extension and adds GIN trigram indexes used by `word_similarity()`.
--
-- Search then matches: exact substring OR trigram-similar word (fuzzy), which
-- removes the hard dependency on Elasticsearch for a usable demo/deploy.
--
-- Example:
--   SELECT name FROM products
--    WHERE word_similarity('landry', name) > 0.4;
--   -> 20 Mule Team Borax Laundry Booster & Multi-Purpose Cleaner ...
--
-- https://www.postgresql.org/docs/current/pgtrgm.html
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes make `word_similarity()`/`%` predicate lookups fast.
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_description_trgm
    ON products USING gin (description gin_trgm_ops);

COMMIT;
