# Database — PostgreSQL catalog schema

Canonical persistence layer for the Summerhill catalog. PostgreSQL is the **source of truth**; Elasticsearch is a derived search index maintained by the Dagster pipeline.

## Model

```text
categories 1 ─── N subcategories 1 ─── N products 1 ─── N product_images
```

| Table | Purpose | Natural key (for `ON CONFLICT` upserts) |
| --- | --- | --- |
| `categories` | Top-level types (`type` from the scraper) | `slug` |
| `subcategories` | Categories' children (`subType` from the scraper) | `(category_id, slug)` |
| `products` | Scraped product records | `sku` (the source UPC), also `slug` unique |
| `product_images` | One row per image URL per product | `(product_id, image_url)` |

`products` additionally stores every field the scraper extracts (price, currency, availability, description + `description_source`, brand, organic, unit, quantities, main/thumbnail images) so the database fully materialises the scraped catalog rather than a subset.

## Relationships (FKs)

- `subcategories.category_id` → `categories.id` (`ON DELETE CASCADE`)
- `products.category_id` → `categories.id`
- `products.subcategory_id` → `subcategories.id`
- `product_images.product_id` → `products.id` (`ON DELETE CASCADE`)

## Indexing strategy

Indexes target the hot read paths (listing, filtering, sorting):

| Index | Why |
| --- | --- |
| `idx_products_category` | filter by category (`WHERE category_id = …`) |
| `idx_products_subcategory` | filter within a category |
| `idx_products_category_price` | filter-by-category + sort-by-price (composite, the common PLP query) |
| `idx_products_price` | stand-alone price sort / range queries |
| `idx_products_availability` | in-stock filtering |
| `idx_subcategories_category` | FK traversal from category → subcategories |
| `idx_product_images_product` | join products → images |
| `products_sku_key`, `products_slug_key`, `categories_slug_key`, `subcategories_category_slug_key` | uniqueness + upsert lookup (automatically indexed) |

Full-text search deliberately lives in Elasticsearch, not Postgres, keeping the DB schema simple and the search performance predictable.

## Migrations

```
database/
├── migrations/
│   ├── up/   001_create_catalog_schema.sql   # apply
│   └── down/ 001_drop_catalog_schema.sql     # rollback
├── README.md
```

- Versioned `up`/`down` pairs; numbered for ordering.
- Every `up` statement is `IF [NOT] EXISTS`-guarded → safe to re-run.
- `docker-compose` mounts `migrations/up` into the Postgres container's `docker-entrypoint-initdb.d`, so a fresh `docker compose up database` applies the schema automatically on first boot (only runs when the data volume is empty).

## Local usage

```bash
# Full stack (applies migrations on first boot):
docker compose up -d database

# Apply migrations to an already-initialised database:
docker compose exec -T database psql -U postgres -d afcommerce \
  -f /docker-entrypoint-initdb.d/001_create_catalog_schema.sql

# Inspect:
docker compose exec database psql -U postgres -d afcommerce -c "\dt"
docker compose exec database psql -U postgres -d afcommerce -c "\di"
```

Connection: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/afcommerce`.

## Using Supabase instead of Docker

Repo is connection-string driven — point `DATABASE_URL` at hosted Postgres and the same schema works unchanged (Postgres 15, standard SQL).

1. Set in `.env` (never committed):
   - `DATABASE_URL=postgresql://postgres.<project-ref>:<DB_PASSWORD>@db.<project-ref>.supabase.co:5432/postgres`
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the storefront
2. Apply the migration via **SQL Editor** (paste `migrations/up/001_create_catalog_schema.sql`) or:
   ```bash
   psql "postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres" \
     -f migrations/up/001_create_catalog_schema.sql
   ```
3. Verify: `SELECT tablename FROM pg_tables WHERE schemaname='public';`

> Free-tier projects auto-pause after ~1 week idle — wake it before demoing. Long-running tools (migrations, psql) should use the direct `db.<ref>` host; serverless/Node pools can use the pooler host.

## Idempotent ingestion contract

The Dagster pipeline (Section: Ingestion) uses these invariants:

- `categories` upserted on `slug`
- `subcategories` upserted on `(category_id, slug)`
- `products` upserted on `sku` (a repeated run updates prices/availability instead of inserting duplicates)
- `product_images` upserted on `(product_id, image_url)` (`CASCADE` removes orphan rows from re-scraped products)

`created_at`/`updated_at` are maintained automatically (defaults + `set_updated_at()` trigger).