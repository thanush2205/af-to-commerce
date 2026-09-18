# Dagster — Offline Ingestion Pipeline

Orchestrates reading the scraper's JSON, transforming it, and loading it into
**PostgreSQL (source of truth)** and **Elasticsearch (derived search index)**.

```
scraper/output/products.json
        │
        ▼
raw_products ──► normalized_products ──► postgres_products ──► elasticsearch_products
(read JSON)       (transform/normalize)    (upsert, source       (bulk upsert,
                   flatten + coerce)        of truth)             _id = sku)
```

## Assets

| Asset                | What it does                                                    | Idempotency                                    |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `raw_products`       | Reads `products.json` (external scraper artifact)               | read-only                                      |
| `normalized_products`| Flattens grouped JSON, coerces numerics/booleans, slugifies     | pure function; writes deterministic JSON       |
| `postgres_products`  | Upserts categories/subcategories/products/images                | `ON CONFLICT` on natural keys in one tx        |
| `elasticsearch_products` | Bulk-upserts documents                          | `_id = sku` (never duplicates)                 |

The job is `catalog_ingestion` (all four assets). A daily 03:00 schedule is
registered but **stopped by default** — enable it from the Dagster UI if you
want the pipeline to run on its own.

## Idempotency (safe reruns)

- Postgres upserts on natural keys: `categories.slug`, `subcategories
  (category_id, slug)`, `products.sku`, `product_images (product_id, image_url)`.
  A rerun updates rows in place — never duplicates.
- Elasticsearch indexes with `_id = product.sku`; rerunning replaces docs.
- The whole Postgres batch runs in **one transaction**: any failure rolls back,
  so a partial ingestion is never committed.

## Failure handling

- `postgres_products` fails the op (and rolls back) on any statement error.
- `elasticsearch_products` depends on `postgres_products` (Postgres stays the
  source of truth) and raises on bulk failures — "Elasticsearch ingestion
  failed" is a failed Dagster run, never a silent success.
- Each asset logs structured run stats (`postgres: categories=… products=…`,
  `elasticsearch: indexed=… total=…`).

## Layout

```
dagster/
├── workspace.yaml            # code location for webserver/daemon
├── definitions.py            # re-exports Definitions for auto-discovery
├── requirements.txt          # psycopg3, elasticsearch-py, pytest
├── Dockerfile                # dagster/dagster-celery-k8s + runtime deps
├── src/
│   ├── config.py             # env-driven paths & connection strings
│   ├── normalize.py          # pure transform (unit-tested)
│   ├── postgres.py           # single-transaction natural-key upserts
│   ├── elasticsearch_loader.py  # bulk upsert, reuses Search mapping
│   └── assets.py             # asset defs, job, schedule, Definitions
└── tests/                    # pytest (normalize + upsert-SQL contracts)
```

## Run it

Everything is wired into Docker Compose (builds on
`dagster/dagster-celery-k8s`, pins the pipeline to the internal
Postgres/Elasticsearch services, mounts `scraper/output` as
`/workspace/input` and the Search mapping as `/workspace/mappings`).

```bash
# 1. Stack up: Postgres (applies schema on first boot) + Elasticsearch + Dagster
docker compose up -d --build database elasticsearch dagster-webserver dagster-daemon

# 2. Unit tests
docker compose exec -T dagster-webserver pytest -q /workspace/tests

# 3. Run the pipeline end-to-end
docker compose exec -T dagster-webserver \
  dagster asset materialize -f /workspace/definitions.py \
  --select raw_products,normalized_products,postgres_products,elasticsearch_products
# (-f is required by the CLI; upstream assets are NOT auto-included, so list all four)

# 4. Rerun to prove idempotency — counts stay identical
docker compose exec -T dagster-webserver \
  dagster asset materialize -f /workspace/definitions.py \
  --select raw_products,normalized_products,postgres_products,elasticsearch_products

# 5. Inspect results
docker compose exec -T database psql -U postgres -d afcommerce -c \
  "SELECT (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM categories) AS categories;"
curl -s http://localhost:9200/products/_count
```

The Dagster UI (asset graph, run history, logs) is at
[http://localhost:3000](http://localhost:3000).

## Elasticsearch sample queries

After materialization the `products` index holds one document per SKU. Field
notes for writing queries:

| Field        | Mapping   | Use for                                  |
| ------------ | --------- | ---------------------------------------- |
| `name`       | `text`    | full-text match (dedicated `name.keyword` for exact) |
| `description`| `text`    | full-text match                          |
| `category`, `subcategory` | `keyword` | exact term filter |
| `price`      | `double`  | range filters + sorting                  |
| `organic`, `availability` | `boolean` / `keyword` | filters |

`category`/`subcategory` store the display names as scraped (e.g. `"Bakery"`),
so term filters must use the exact stored name (the Search API resolves the
storefront's slug form to the name before hitting ES).

```bash
# 0. Total documents
curl -s "http://localhost:9200/products/_count?pretty"

# 1. Full-text search on NAME
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "match": { "name": "naan" } } }'

# 2. Full-text search on DESCRIPTION
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "match": { "description": "wild rice" } } }'

# 3. Both at once — name weighted higher, description boosts relevance
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "multi_match": {
    "query": "organic tomato",
    "fields": ["name^2", "description"],
    "tie_breaker": 0.3 } } }'

# 4. Filter BY CATEGORY (+ count)
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "term": { "category": "Bakery" } } }'

# 5. Category filter + SORT BY PRICE (cheapest first)
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "term": { "category": "Produce" } },
  "sort": [ { "price": { "order": "asc" } } ],
  "size": 10 }'

# 6. Combined: name match + category filter + price range + price sort
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "bool": {
    "must": { "match": { "name": "chips" } },
    "filter": [
      { "term": { "category": "Snacks" } },
      { "range": { "price": { "gte": 2, "lte": 8 } } } ] } },
  "sort": [ { "price": { "order": "desc" } } ] }'

# 7. Typo tolerance (mirrors the app's "did you mean" fallback)
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "query": { "match": { "name": { "query": "landry", "fuzziness": "AUTO" } } } }'

# 8. Facet counts per category (search UI sidebar)
curl -s "http://localhost:9200/products/_search?pretty" -H "Content-Type: application/json" -d '
{ "size": 0,
  "aggs": { "by_category": { "terms": { "field": "category", "size": 25 } } } }'
```

For the Elastic Cloud endpoint add the auth header, e.g.
`-H "Authorization: ApiKey $ELASTICSEARCH_API_KEY"`.

## Environment

Read from repo root `.env` via the compose `x-app-environment` block; inside the
stack the pipeline is pinned to internal hosts (`database`, `elasticsearch`).

| Variable              | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `DATABASE_URL`        | Postgres DSN (compose pins internal one)       |
| `ELASTICSEARCH_URL`   | ES endpoint                                    |
| `ELASTICSEARCH_INDEX` | index name (default `products`)                |
| `PRODUCTS_JSON_PATH`  | input JSON path (compose pin: `/workspace/input/products.json`) |
| `ES_MAPPING_PATH`     | Search-section mapping JSON                    |

## Notes / tradeoffs

- **Postgres stays the source of truth.** Elasticsearch is re-built from the
  normalized JSON after Postgres succeeds, never queried-for-authority.
- **Python implementation** duplicates the standalone Node loader's purpose
  deliberately: Dagster is the single production write path in one language.
  The Node tool remains for ad-hoc Search-section testing.
- **Products upsert on `sku`** (scraper UPCs are unique). Names are *not* always
  unique in the real catalog (6 slug collisions found), so normalization
  deterministically suffixes colliding slugs (`...-2`, `...-3`, …) and logs a
  warning with the affected pairs — see `_dedupe_slugs` in `normalize.py`.
- Schedule defaults to stopped so the demo stack doesn't run unrequested jobs.