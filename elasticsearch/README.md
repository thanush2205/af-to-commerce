# Elasticsearch — Search Index

Search engine for the Summerhill Market catalog, designed so **PostgreSQL is the
source of truth** and **Elasticsearch is the read/search layer**.

```
PostgreSQL (source of truth)
     │   product data (upserted)
     ▼
Elasticsearch (search index)
     │
     ▼
Fast full-text search + category filter + price sort + pagination
```

## Layout

```
elasticsearch/
├── mappings/product.index.json   # Index settings + field mapping (source of truth for the schema)
├── src/
│   ├── env.js                    # Loads repo-root .env
│   ├── client.js                 # ES client from ELASTICSEARCH_URL (+ optional API key)
│   ├── ensure-index.js           # Create index from mapping; idempotent; --force to recreate
│   ├── index-products.js         # Bulk-upsert scraper/products.json into the index
│   ├── search.js                 # buildProductSearchQuery() + runSearch() — used by the API
│   ├── slug.js                   # Stable product slug (must match ingestion)
│   └── smoke.js                  # Live end-to-end demo of the required queries
├── test/search.test.js           # 11 unit tests on the query builder
├── query-examples.md             # Raw DSL examples (assessment deliverable)
└── README.md
```

## Quick start

```bash
# 1. Start Elasticsearch (8.x) + Kibana
docker compose up -d elasticsearch kibana

# 2. Create the index from the mapping (idempotent)
cd elasticsearch && npm run ensure-index

# 3. Load the scraper output (5,047 products, idempotent bulk upsert)
npm run index-products            # full catalog
npm run index-products -- --limit 50   # quick partial load

# 4. Verify required search features end-to-end
npm run smoke
```

## The mapping

`name` and `description` are `text` (analyzed) for `multi_match` full-text
search; everything that needs exact matching, filtering, or sorting
(`category`, `subcategory`, `availability`, `brand`, `price`, `sku`) is mapped
for it explicitly:

| Field         | Type    | Used for                            |
| ------------- | ------- | ----------------------------------- |
| `name`        | text    | full-text (boosted `^3`) + `name.keyword` for sorting |
| `description` | text    | full-text                           |
| `price`       | double  | range filter + sort                 |
| `category`    | keyword | exact term filter / agg             |
| `subcategory` | keyword | exact term filter                   |
| `availability`| keyword | exact term filter                   |
| `sku`/`id`    | keyword | document `_id`, de-dup              |
| images/brand/organic/unit… | keyword/boolean/double | payload only, most `index: false` |

`dynamic: false` prevents accidental schema drift.

## Idempotent ingestion

The bulk loader uses `_id = product.sku`, so re-running the load **updates in
place** and never duplicates — same invariant the Postgres upsert uses. This is
the seam the Dagster pipeline drives next (Section 5): read
`scraper/output/products.json` → upsert Postgres → upsert Elasticsearch in one
idempotent run.

## Env variables

Set in repo root `.env` (see `.env.example`):

| Variable              | Local                       | Compose (container)     |
| --------------------- | --------------------------- | ----------------------- |
| `ELASTICSEARCH_URL`   | `http://localhost:9200`     | `http://elasticsearch:9200` (fixed in compose) |
| `ELASTICSEARCH_INDEX` | `products`                  | `products`              |
| `ELASTICSEARCH_API_KEY` | *(optional, Elastic Cloud)* | —                       |