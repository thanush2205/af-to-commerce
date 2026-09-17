# af-to-commerce

Mini grocery commerce platform. Scrapes the Summerhill Market online catalog, ingests it via Dagster into PostgreSQL + Elasticsearch, serves it through a Node.js API and a Next.js/Payload storefront with Stripe checkout and a Stripe Connect marketplace.

## Architecture

```text
Summerhill Market (Homesome API)
        |
        |   scraper/
        |--> products.json
        |
dagster/ --> PostgreSQL (source of truth) + Elasticsearch (search index)
        |
apps/api/ --> Node.js API (products, search, checkout)
        |
apps/web/ --> Next.js + Payload CMS storefront
        |
stripe/  --> Checkout + Stripe Connect marketplace
```

| Directory        | Responsibility                                        |
| ---------------- | ----------------------------------------------------- |
| `apps/`          | Next.js + Payload storefront and Node.js API           |
| `scraper/`       | Summerhill catalog scraper -> `products.json` (Stage 1, DONE) |
| `dagster/`       | Data orchestration & scheduling (assets/jobs)          |
| `database/`      | Database schemas, migrations, seed data                |
| `elasticsearch/` | Search index mappings, loaders, queries                |
| `stripe/`        | Stripe billing, checkout & Stripe Connect              |

## Stage 1 — Product scraper (DONE)

Inspects the live source: `shop.summerhillmarket.com` is a WordPress front-end backed by the **Homesome API** (`https://user-api.gethomesome.com`, `apikey` header). All product data is API-driven — no HTML scraping or headless browser needed.

- `GET /product/list?listType=ui` -> full catalog (5,047 products, one unpaginated response)
- `GET /product?name=<upc>` -> per-product detail endpoint
- Images reconstructed from the site's own S3 pattern; category = `type`, subcategory = `subType`
- Source exposes **no product description** -> mapped from real `disclaimer` text, provenance tracked in `descriptionSource` (documented assumption)

Rerun:

```bash
cd scraper
npm install
npm run scrape     # -> scraper/output/products.json (+ summary.json)
npm test           # 9 unit tests
```

See [scraper/README.md](scraper/README.md) for full behaviour matrix, field mapping, rerun instructions and assumptions.

## Section 3 — PostgreSQL schema (DONE)

Canonical catalog schema (categories, subcategories, products, product_images) with natural-key uniqueness for idempotent upserts, FKs + cascades, indexes for category/price/availability lookups, an `updated_at` trigger, and CHECK constraints.

- Migrations: `database/migrations/up/001_create_catalog_schema.sql` (rollback in `down/`)
- Target database: Supabase (see `.env` `DATABASE_URL`); Docker Compose also mounts the migration for local Postgres
- `docker-compose` database service mounts `./database/migrations/up` on first boot

See [database/README.md](database/README.md).

## Section 4 — Elasticsearch search index (DONE)

Search layer is a read/index-only Elasticsearch, with **PostgreSQL kept as the source of truth** — Postgres owns writes and uniqueness; ES owns fast full-text search.

- `elasticsearch/mappings/product.index.json` — mapping: `name`/`description` as `text` (full-text, `name` boosted), category/subcategory/availability as `keyword` (exact filter), `price` as `double` (range + sort)
- `buildProductSearchQuery()` / `runSearch()` implement `multi_match` full-text search, `term` category filters, price/name sorting and `from`/`size` pagination
- Bulk loader `index-products.js` upserts by `_id = sku` (idempotent, no duplicates on re-run)
- 11 unit tests on the query builder pass

Rerun:

```bash
docker compose up -d elasticsearch kibana
cd elasticsearch
npm install
npm run ensure-index       # create index from mapping (idempotent)
npm run index-products     # bulk-load scraper/output/products.json (5,047 docs)
npm run smoke              # demo: full-text, category filter, price sort, pagination
npm test                   # 11 unit tests
```

See [elasticsearch/README.md](elasticsearch/README.md) and [query-examples.md](elasticsearch/query-examples.md).

## Section 5 — Dagster ingestion pipeline (DONE)

Orchestrates the offline ingestion: reads `scraper/output/products.json`,
normalizes it, upserts **PostgreSQL** (source of truth) and bulk-upserts
**Elasticsearch** (derived search index).

- Assets: `raw_products` → `normalized_products` → `postgres_products` → `elasticsearch_products`; job `catalog_ingestion`
- **Idempotent reruns**: Postgres `ON CONFLICT` on natural keys in a single transaction; ES `_id = sku` — a second run updates in place, never duplicates
- **Failure handling**: DB batch rolls back on error; ES op raises on bulk failures (no silent success); every asset logs run stats
- Daily 03:00 schedule registered (stopped by default)
- 16 pytest tests (transform logic + upsert SQL contracts) pass

Rerun:

```bash
docker compose up -d --build database elasticsearch dagster-webserver dagster-daemon
docker compose exec -T dagster-webserver pytest -q /workspace/tests
docker compose exec -T dagster-webserver \
  dagster asset materialize -f /workspace/definitions.py \
  --select raw_products,normalized_products,postgres_products,elasticsearch_products
```

Dagster UI: `http://localhost:3000`. See [dagster/README.md](dagster/README.md).

## Section 6 — Backend API (DONE)

Node.js (Express) bridge between the storefront and the databases:

- `GET /api/products`, `GET /api/products/:id` — **PostgreSQL** catalog (filter/sort/paginate, detail with images)
- `GET /api/categories` — **PostgreSQL** category tree with counts
- `GET /api/search` — **Elasticsearch** full-text search (fuzzy, filters, `sort=price_asc`, pagination)
- JSON `{ data, pagination }` / `{ error }` envelope; 19 `node --test` unit tests pass

Rerun:

```bash
docker compose up -d --build api
docker compose exec -T api npm test
curl "http://localhost:8000/api/search?q=chips&sort=price_asc&limit=5"
```

Live API: `http://localhost:8000/api`. See [apps/README.md](apps/README.md).

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- Node.js >= 20 (scraper, elasticsearch tooling)
- Supabase (or any Postgres 14+) for the source-of-truth database

## Configuration

All configuration is driven by environment variables — copy `.env.example` to `.env` and review. `.env` is gitignored and holds real secrets (Supabase `DATABASE_URL`, publishable key). No secrets are committed.

## Development

- Scraper → Dagster → PostgreSQL + Elasticsearch → Node API → Next.js storefront → Stripe
- Dagster schedules scrape + enrichment pipelines
- Stripe webhooks handled in `stripe/`, synced to the database

## License

Proprietary.