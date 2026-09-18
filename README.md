# af-to-commerce

Mini grocery commerce platform. Scrapes the Summerhill Market online catalog, ingests it via Dagster into PostgreSQL + Elasticsearch, serves it through a Node.js API and a Next.js/Payload storefront with Stripe checkout and a Stripe Connect marketplace.

Live reference builds (demo, free-tier so they may sleep):
- API: <https://af-to-commerce-api.onrender.com> (health: `/healthz`)
- Storefront + CMS Admin: deployed on Vercel (see `docs/DEPLOYMENT.md`)

## What this project is

A small online grocery shop, built end-to-end to show how a real product catalog
gets scraped, cleaned, stored, searched, served, and sold:

1. **Scraper** copies the live Summerhill Market catalog into JSON.
2. **Dagster** reads that JSON, cleans it, and loads it into **PostgreSQL**
   (source of truth) and **Elasticsearch** (search index).
3. **Node.js API** serves catalog, search, and Stripe checkout.
4. **Next.js + Payload** storefront shows products and runs the cart/checkout.
5. **Stripe Checkout + Connect** take the payment and split it with merchants.

## Architecture

```text
Summerhill Market (Homesome API)
        |
        |   scraper/
        |--> products.json
        |
dagster/ --> PostgreSQL (source of truth) + Elasticsearch (search index)
        |
apps/   --> Node.js API (products, search, checkout, webhooks)
        |
web/    --> Next.js + Payload CMS storefront
        |
Stripe  --> Checkout Sessions + Stripe Connect marketplace + webhook -> orders
```

| Directory        | Responsibility                                        |
| ---------------- | ----------------------------------------------------- |
| `apps/`          | Node.js API (catalog, search, checkout, Stripe webhooks) |
| `web/`           | Next.js + Payload CMS storefront                      |
| `scraper/`       | Summerhill catalog scraper -> `products.json` (Stage 1, DONE) |
| `dagster/`       | Data orchestration & scheduling (assets/jobs)          |
| `database/`      | Database schemas, migrations, seed data                |
| `elasticsearch/` | Search index mappings, loaders, queries                |
| `stripe/`        | Stripe Checkout + Connect fund-flow documentation |

### Architecture decisions

- **PostgreSQL is the source of truth.** Every product row, category, merchant
  and order lives in Postgres. Elasticsearch is only a fast search index built
  *from* Postgres/Dagster — the app never asks Elasticsearch for authority.
- **Elasticsearch for search, Postgres for everything else.** Full-text search
  needs relevance and fuzziness; Postgres stays the relational owner. If
  Elasticsearch is slow or down, the API falls back to Postgres `pg_trgm`
  fuzzy search with the same response shape, so search never hard-fails.
- **Server-side pricing.** The browser only ever sends `{ sku, quantity }`.
  Prices, totals, fees and merchant shares are recomputed by the API from the
  database and Stripe, never trusted from the client.
- **Raw-body webhooks before JSON parsing.** Stripe's signature check needs the
  exact bytes Stripe sent, so the webhook router mounts before `express.json()`.
- **One write path in one language.** Dagster (Python) is the single production
  ingestion route; the standalone Node ES loader exists only for ad-hoc testing.

### Data flow (end to end)

```text
scraper -> products.json -> Dagster (normalize) -> PostgreSQL  (all products)
                                          \-> Elasticsearch (search index)
API serves: /api/products  (Postgres)
            /api/search    (Elasticsearch, falls back to Postgres pg_trgm)
Storefront: /products -> cart -> /api/checkout -> Stripe hosted page
Stripe webhook: checkout.session.completed -> orders table (revenue split)
```

## Setup (local development)

Prerequisites: Docker Desktop, Node.js >= 20, and a PostgreSQL 14+ database
(local Postgres or Supabase) with `pg_trgm` available.

```bash
# 1. Install dependencies for each piece that runs natively
cd scraper && npm install
cd ../elasticsearch && npm install
cd ../apps && npm install
cd ../web && npm install

# 2. Config — copy the example and fill in real values (never commit .env)
cp .env.example .env          # review every variable (DATABASE_URL, Stripe keys, ES)

# 3. Start the dependency stack (Postgres applies schema on first boot)
docker compose up -d --build database elasticsearch

# 4. Ingest the catalog once (scraper JSON -> Postgres + Elasticsearch)
docker compose exec -T dagster-webserver pytest -q /workspace/tests
docker compose exec -T dagster-webserver \
  dagster asset materialize -f /workspace/definitions.py \
  --select raw_products,normalized_products,postgres_products,elasticsearch_products

# 5. Run the API + storefront
cd apps && npm run dev          # http://localhost:8000/api
cd web  && npm run dev          # http://localhost:3000  (/admin for the CMS)

# 6. Stripe webhooks locally (prints a whsec_... secret; put it in apps/.env)
stripe login
stripe listen --forward-to localhost:8000/api/stripe/webhook

# 7. Seed the CMS + marketplace demo data (idempotent)
cd web && npm run seed
cd apps && npm run seed:marketplace
```

Then verify:
`curl "http://localhost:8000/api/search?q=chips"` and open the storefront at
`http://localhost:3000/products`. Pay with the Stripe test card
`4242 4242 4242 4242`.

> Each component has its own README with rerun steps and tests
> (`scraper/`, `dagster/`, `elasticsearch/`, `database/`, `apps/`, `web/`).
> Deployment to Render + Vercel is in `docs/DEPLOYMENT.md`.

## Stripe flow (end to end)

Checkout uses **Stripe Checkout Sessions** with server-side pricing. The
storefront never sends money amounts — only items.

```text
[Storefront cart]  POST /api/checkout  { items: [{ sku, quantity }] }
        |
        v
[API]  reads price + stock from PostgreSQL (never trusts the browser)
        \-> picks a merchant payout flow from the cart:
              one verified merchant  -> destination charge (+ Connect fee)
              otherwise             -> platform charge (transfer later)
        v
[Stripe] returns a hosted checkout URL -> customer pays (test card 4242 4242 4242 4242)
        v
[webhook] Stripe posts checkout.session.completed
        \-> verifies stripe-signature on the raw body
        \-> records the order in `orders` (idempotent, ON CONFLICT session id)
        \-> stores the exact platform/merchant split computed by the API
        v
[Storefront] /checkout/success?session_id=... reads the authoritative result
```

Key rules:

- **Platform fee** — one tested function `calculatePlatformFee` (never a
  hardcoded percentage in a flow):

  | Order total | Platform fee |
  | ----------- | ------------ |
  | > $100      | 10%          |
  | $50 – $100  | 15%          |
  | < $50       | 20%          |

- **Revenue split is computed server-side** on minor units and re-used by the
  checkout session, the webhook, and the transfer endpoint — so what the
  customer pays, what the platform keeps, and what the merchant receives can
  never disagree.
- **Merchant status gates money.** Merchants must be `verified` for
  destination charges or transfers; `GET /api/merchants/:id` shows the live
  Stripe account status.
- **Idempotent webhook.** Re-delivered events (Stripe sends at-least-once)
  `ON CONFLICT DO NOTHING` on `stripe_session_id`.

Two Connect fund flows are implemented (diagrams in `stripe/README.md`):
**destination charges** (single verified merchant: fee taken at payment,
merchant share settles immediately) and **separate charges + transfers**
(platform charge, merchant share pushed later as an idempotent `Transfer`,
keyed to the order session). Inspect a paid order with
`GET /api/orders/:sessionId`.

> Demo caveat: the live platform account has **Connect not enabled** yet, so
> merchants are simulation accounts (`acct_sim_*`). Orders record and fees
> split correctly, but actual merchant transfers return a 409 until Connect is
> activated.

## Search design

```text
Storefront  /products?q=chips&category=dry-goods-and-baking&sort=price_asc
        |
        v
API        GET /api/search
        |-- Elasticsearch first (2-4s budget, ES_REQUEST_TIMEOUT_MS)
        |      multi_match on name^2 + description      (full-text relevance)
        |      term     category / subcategory          (exact filters; slugs
        |                                                resolved to stored names)
        |      term     availability / organic
        |      range    price
        |      sort     price / name, from/size pagination
        |
        \-- Postgres fallback (ES down/slow)
               ILIKE '%q%' on name + description        (exact substring)
               + pg_trgm word_similarity > 0.4          (typo tolerance, e.g. "landry")
               + the same filters and sorting            (identical response shape)
```

Design points:

- **Same response envelope either way** — `{ data, pagination }`. The
  storefront cannot tell which engine answered, so a search outage degrades to
  a slightly slower Postgres query instead of an error page.
- **Filters use stored display names.** `category`/`subcategory` are `keyword`
  fields in Elasticsearch, and the API resolves the storefront's slug form to
  the exact stored name before the `term` query (SQL helper `canonicalName`).
- **Relevance over exact-only.** `name` is boosted (`name^2`) over
  `description`, and `multi_match` with `tie_breaker` blends both fields.
  `name.keyword` (lowercase normalizer) exists for exact/aggregation use.
- **Typo tolerance on the fallback too.** When the exact phrase returns
  nothing, the Postgres path retries with `pg_trgm` `word_similarity`
  ("landry" -> "laundry"), matching the Elasticsearch-first behavior.
- Live curl examples are in `elasticsearch/query-examples.md` and in the
  Dagster README's "Elasticsearch sample queries" section.

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
- `GET /api/search` — full-text search (Elasticsearch when available, else PostgreSQL `pg_trgm` fuzzy fallback), filters, `sort=price_asc`, pagination
- JSON `{ data, pagination }` / `{ error }` envelope; 38 `node --test` unit tests pass

Rerun:

```bash
docker compose up -d --build api
docker compose exec -T api npm test
curl "http://localhost:8000/api/search?q=chips&sort=price_asc&limit=5"
```

Live API: `http://localhost:8000/api`. See [apps/README.md](apps/README.md).

## Section 12 — Stripe Checkout (DONE)

Checkout runs on Stripe Checkout Sessions with **prices resolved server-side** — the
storefront sends only `{ sku, quantity }`; the Node API re-reads price/stock from
PostgreSQL and builds the line items. The amount shown in the browser is never trusted.

- `POST /api/checkout` — creates a Checkout Session; body `{ items: [{sku, quantity}], successUrl?, cancelUrl? }`
- `GET /api/checkout/session/:id` — confirmation page reads the authoritative amount/status
- `POST /api/stripe/webhook` — verifies the `stripe-signature` on the RAW body, records orders idempotently into `orders`
- Storefront `/checkout` → Stripe hosted page → `/checkout/success?session_id=...`

```bash
# 1. Set a real test key (until then checkout returns 503 stripe_not_configured)
#    in apps/.env:  STRIPE_SECRET_KEY=sk_test_...
# 2. Relay webhooks locally (obtains STRIPE_WEBHOOK_SECRET):
stripe login
stripe listen --forward-to localhost:8000/api/stripe/webhook
# 3. Pay with the test card  4242 4242 4242 4242 (any future expiry/CVC)
```

Why the webhook runs before `express.json()`: in `apps/src/app.js` the webhook router
uses `express.raw({ type: "application/json" })` so the signed raw body is available;
it is registered BEFORE the JSON body parser.

## Section 13 — Stripe Connect (DONE)

Marketplace multi-tenancy via **Custom Connected Accounts** (Stage 4).

- Migration `002_stripe_connect.sql` adds `merchants`, links `products.merchant_id`, and the `orders` ledger
- `POST /api/merchants` programmatically creates a Custom Connected Account on the platform (no merchant signup flow)
- `GET /api/merchants` / `GET /api/merchants/:id` — list/detail with live account status
- `PATCH /api/merchants/:id/status` — **status simulator** (`verified | failed | restricted`)
- `/merchants` storefront page shows status + payout gating

Merchant status gates money: destination charges and transfers are both blocked unless
status is `verified`.

## Section 14 — Revenue share (DONE)

Platform fee is a **single programmatic function** (`calculatePlatformFee` in
`apps/src/stripe.js`, unit tested), driven by a tier table:

| Order amount  | Platform fee |
| ------------- | ------------ |
| > $100        | 10%          |
| $50 – $100    | 15%          |
| < $50         | 20%          |

The split is computed on the server-side total (minor units, exact integers) and is
the same function used by the webhook, the checkout session and the transfer endpoint —
never a hardcoded percentage in a payment flow.

## Section 15 — Fund flows (DONE)

Two Stripe Connect flows are implemented and documented (see
[stripe/README.md](stripe/README.md) for diagrams + balance movement):

1. **Destination charges** — when a cart maps to a single `verified` merchant, the
   Checkout Session uses `payment_intent_data.transfer_data` + `application_fee_amount`.
   The customer pays, the platform fee is taken immediately, and the merchant share
   settles into the connected account's balance — no separate transfer.
2. **Separate charges and transfers** — the charge runs entirely on the platform; the
   merchant share is pushed later as a `Transfer` (idempotent per order session). The
   merchant is tagged on the session metadata even for platform charges, so a
   restricted merchant's order can be settled once they become payable.

```bash
# Make the marketplace demoable (idempotent): 3 merchants + product assignment:
cd apps && npm run seed:marketplace
```

Inspecting a paid order shows where the money is (`GET /api/orders/:sessionId`):
the authoritative **Payment Intent**, the computed revenue split, any Transfer,
and live **platform + connected-account balances**.

**Security note (also covered in the Loom):** the frontend amount is never trusted.
Prices, totals, the platform fee and the merchant share are all recomputed by the API
from PostgreSQL + Stripe amounts before any money moves.

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