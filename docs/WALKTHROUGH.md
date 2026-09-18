# AFTO Commerce — Full Walkthrough (for the Loom)

This document explains the whole project in simple words. It covers every part:
the scraper, the data pipeline, the database, search, the website, the API,
the cart and checkout, and the Stripe marketplace.

Use this as a script for a 10–15 minute Loom video.

---

## 1. What the app is (30 seconds)

It is a small online grocery shop.

We do not type products in by hand. Instead, we copy the real product catalog
from Summerhill Market. Then we clean the data, store it in PostgreSQL, and
index it for search. A Node.js API serves the data. A Next.js + Payload website
shows the shop to the customer. Stripe handles the payment. Stripe Connect
handles the merchants who sell on the platform.

The four assessment stages:

1. **Stage 1** — Scrape the product catalog.
2. **Stage 2** — Ingest the data with Dagster into PostgreSQL + Elasticsearch.
3. **Stage 3** — Storefront (Next.js + Payload), Backend API (Node.js), Stripe Checkout.
4. **Stage 4** — Stripe Connect marketplace, revenue share, fund flows.

---

## 2. High-level architecture

```text
Summerhill Market (Homesome API)
        |
        |  scraper/  ->  scraper/output/products.json
        |
        v
dagster/  ->  PostgreSQL (source of truth)
        \->  Elasticsearch (search index, optional)

PostgreSQL
        |
        v
apps/  -> Node.js API  ->  Next.js + Payload storefront
        |
        v
stripe/  -> Checkout  ->  Stripe Connect marketplace
```

Two golden rules of the design:

- **PostgreSQL is the source of truth.** All writes and prices come from here.
- **Elasticsearch is only a search index.** It can be offline. The API then
  falls back to PostgreSQL fuzzy search, so the shop still works.

---

## 3. Repository map

| Folder           | What it does |
| ---------------- | ------------ |
| `scraper/`       | Stage 1. Reads the live API, writes `products.json`. |
| `dagster/`       | Stage 2. Normalizes data, loads PostgreSQL and Elasticsearch. |
| `database/`      | SQL migrations and schema docs. |
| `elasticsearch/` | Index mapping, loader, query examples. |
| `apps/`          | Node.js API (backend). |
| `web/`           | Next.js + Payload storefront (frontend). |
| `stripe/`        | Stripe Checkout + Connect fund-flow docs. |
| `docker-compose.yml` | Runs all services with Docker. |

---

## 4. Stage 1 — The scraper

**Folder:** `scraper/`

The source site `shop.summerhillmarket.com` is a WordPress front end. But the
real data comes from the **Homesome API** (`https://user-api.gethomesome.com`).
So we do not scrape HTML. We call the API. This is faster and cleaner.

Key calls:

- `GET /product/list?listType=ui` returns the whole catalog in one response
  (5,047 products).
- `GET /product?name=<upc>` returns one product detail.

How the scraper maps fields:

- Category comes from `type`.
- Subcategory comes from `subType`.
- Images are rebuilt from the site's own S3 image pattern.
- The source has **no description**. So we map the real `disclaimer` text and
  record where it came from in `descriptionSource`. This is a documented
  assumption, not fake data.

Output:

- `scraper/output/products.json` — the clean product list.
- `scraper/output/summary.json` — counts and run stats.

Commands:

```bash
cd scraper
npm install
npm run scrape    # writes products.json
npm test          # 9 unit tests
```

Honest notes:

- About 96.5% of products have an empty description, because the source has
  none. We do not invent text.
- 192 products have no image in the source.
- The retry "jitter" in the README is not actually implemented (dead code).
- `--limit` has a small NaN edge case.

---

## 5. Stage 2 — Dagster pipeline, PostgreSQL, Elasticsearch

**Folder:** `dagster/`

Dagster runs the ingestion as four assets in order:

```text
raw_products
    -> normalized_products
        -> postgres_products
            -> elasticsearch_products
```

Job name: `catalog_ingestion`. There is also a daily 03:00 schedule, but it is
**stopped by default**.

- **Idempotent runs.** Postgres uses `ON CONFLICT` on natural keys inside one
  transaction. Elasticsearch uses `_id = sku`. Running twice updates in place
  and never duplicates.
- **Failure handling.** If a DB batch fails, the whole batch rolls back. If the
  ES bulk call fails, it raises — no silent success. Every asset logs its stats.

Commands (Docker path):

```bash
docker compose up -d --build database elasticsearch dagster-webserver dagster-daemon
docker compose exec -T dagster-webserver pytest -q /workspace/tests
docker compose exec -T dagster-webserver \
  dagster asset materialize -f /workspace/definitions.py \
  --select raw_products,normalized_products,postgres_products,elasticsearch_products
```

Dagster UI: `http://localhost:3000`.

### PostgreSQL schema

**Folder:** `database/`

Tables:

- `categories`
- `subcategories`
- `products`
- `product_images`
- `merchants` (added in migration 002)
- `orders` (ledger, added in migration 002)

Good practices used:

- Natural-key uniqueness, so upserts are safe.
- Foreign keys with cascades.
- Indexes for category, price and availability lookups.
- An `updated_at` trigger.
- CHECK constraints.
- A `pg_trgm` migration (003) for fuzzy search.

Migrations:

- `database/migrations/up/001_create_catalog_schema.sql`
- `database/migrations/up/002_stripe_connect.sql`
- `database/migrations/up/003_pg_trgm_search.sql`
- Rollbacks live in `database/migrations/down/`.

### Elasticsearch

**Folder:** `elasticsearch/`

- Mapping file: `elasticsearch/mappings/product.index.json`.
- `name` and `description` are `text` (full-text). `name` is boosted (weight 3).
- category, subcategory and availability are `keyword` (exact filter).
- price is `double` (range filter and sort).
- The loader `index-products.js` upserts with `_id = sku`, so it is idempotent.
- Query builder supports `multi_match` full-text, `term` filters, price/name
  sort, and `from`/`size` pagination.

Important: Elasticsearch is **optional now**. The API tries it first with a
2 second timeout. If it is down, the API uses PostgreSQL fuzzy search. This is
why the shop still works when Elasticsearch is stopped.

Current local state: the Elasticsearch container is **stopped**, and search
works through Postgres. Check the search section below.

---

## 6. Stage 3 — The storefront (website)

**Folder:** `web/` — Next.js (App Router) + Payload CMS 3.

There are two route groups:

- `web/src/app/(storefront)/` — the customer-facing shop. Provides its own
  `<html>` and `<body>`.
- `web/src/app/(payload)/` — the Payload admin panel. Also provides its own
  `<html>` and `<body>`.

There is no root `layout.tsx` on purpose. Each group supplies the full HTML
document. This is why page files must live inside a group. (We fixed a bug
where `merchants/page.tsx` was at the top level and Next.js complained about
"Missing `<html>` and `<body>` tags".)

### Pages

| Route | File | What it shows |
| ----- | ---- | ------------- |
| `/` | `(storefront)/page.tsx` | Home. Hero from Payload, categories, 8 featured products. |
| `/products` | `(storefront)/products/page.tsx` | Product list. Search box, filters, sort, pagination. |
| `/products/[slug]` | `(storefront)/products/[slug]/page.tsx` | One product. Images, price, stock, add to cart. |
| `/cart` | `(storefront)/cart/page.tsx` | Cart. Change quantity, remove item, see total. |
| `/checkout` | `(storefront)/checkout/page.tsx` | Sends cart to the API, creates Stripe Session, redirects. |
| `/checkout/success` | `(storefront)/checkout/success/page.tsx` | Reads the session, shows the real amount, clears cart. |
| `/checkout/cancel` | `(storefront)/checkout/cancel/page.tsx` | Shown when the customer cancels. |
| `/merchants` | `(storefront)/merchants/page.tsx` | Merchant list, account status, payout gating. |
| `/admin` | `(payload)/admin` | Payload admin login and editing. |

### Payload CMS

- Config: `web/src/payload.config.ts`.
- Collections: `web/src/collections/Products.ts`, `Categories.ts`, `Users.ts`.
- Global: `web/src/globals/Hero.ts` (the home hero content).
- Seed script: `web/src/seed.ts`.
- The admin panel runs from the same Next.js app. It uses its own database
  (`afcommerce_cms`).
- One admin user exists: `thanushreddy934@gmail.com` (name `Chinnu_Admin`).

Note: `PAYLOAD_ADMIN_EMAIL` and `PAYLOAD_ADMIN_PASSWORD` in `web/.env` are not
read by `payload.config.ts`. The admin password is whatever was set when the
first user was created.

### Cart

**File:** `web/src/context/CartContext.tsx`

- The cart lives in React context and is saved in the browser's
  `localStorage`.
- No login is needed.
- Actions: add item, increase/decrease quantity, remove item, clear cart.
- `web/src/components/ClearCartOnMount.tsx` empties the cart on the success
  page after a paid order.

### API client

**File:** `web/src/lib/api.ts`

One small wrapper for all API calls. It reads `NEXT_PUBLIC_API_URL`
(`http://localhost:8000`). It also handles CORS-friendly JSON requests and
errors.

---

## 7. Stage 3 — The backend API

**Folder:** `apps/` — Node.js + Express, ESM, port 8000.

Route mounting order matters. Look at `apps/src/app.js`:

1. `POST /api/stripe/webhook` is mounted **before** `express.json()`, because
   the webhook needs the RAW body to verify the Stripe signature.
2. Then `express.json()` runs for all other routes.
3. Then the normal routes.
4. Then a 404 handler and an error handler.

CORS: there is an allowlist middleware. It reads `CORS_ORIGINS` (default
`http://localhost:3000,http://localhost:3001`). It answers `OPTIONS` preflight
with `204` and sets the `Access-Control-Allow-Origin` header. We added this to
fix the browser CORS error between the web app (port 3000) and the API
(port 8000).

Every response uses one envelope: `{ data, pagination }` on success and
`{ error }` on failure.

### Endpoints

| Method | Path | What it does |
| ------ | ---- | ------------ |
| GET | `/healthz` | Health check. |
| GET | `/api/products` | List products from PostgreSQL. Filter, sort, paginate. |
| GET | `/api/products/:id` | One product with all images. |
| GET | `/api/categories` | Category tree with product counts. |
| GET | `/api/search` | Full-text search. ES first, then Postgres. |
| POST | `/api/checkout` | Create a Stripe Checkout Session. |
| GET | `/api/checkout/session/:id` | Read the authoritative session amount/status. |
| POST | `/api/stripe/webhook` | Verify signature, write orders idempotently. |
| GET | `/api/merchants` | List merchants with live account status. |
| POST | `/api/merchants` | Create a Custom Connected Account. |
| GET | `/api/merchants/:id` | Merchant detail. |
| PATCH | `/api/merchants/:id/status` | Status simulator (`verified`, `failed`, `restricted`). |
| GET | `/api/orders/:sessionId` | Payment Intent, revenue split, transfer, balances. |

### Search — important detail

**File:** `apps/src/routes/search.js`

The search has two layers:

1. **Elasticsearch first.** It runs with a 2 second timeout.
2. **PostgreSQL fallback.** If ES is down or slow, we search Postgres.

The Postgres fallback has two passes:

- **Pass 1:** exact `ILIKE` match.
- **Pass 2:** only if pass 1 finds nothing, a fuzzy match using the `pg_trgm`
  extension. It uses `word_similarity(name, query) > 0.4` and sorts by the best
  match.

This gives typo tolerance without needing Elasticsearch. Examples that work:

- `landry` → finds "Laundry Booster" products.
- `deterjent` → finds "detergent" products.
- `chips` → 98 results.
- `zzzz` → 0 results (correctly empty).

`apps/src/es.js` accepts a `requestTimeout` option. `trgmEnabled()` caches the
check for the `pg_trgm` extension.

---

## 8. Stage 3 — Cart, checkout and security

### The checkout flow

1. Customer adds items to the cart. The cart only stores `{ sku, quantity }`.
2. On `/checkout`, the web app calls `POST /api/checkout` with the cart.
3. The API looks up each SKU in PostgreSQL. It re-reads the real price and
   stock. It builds the Stripe line items on the server.
4. The API creates a Stripe Checkout Session and returns the hosted URL.
5. The browser redirects to the Stripe hosted page.
6. Customer pays with test card `4242 4242 4242 4242` (any future date/CVC).
7. Stripe sends a webhook to `POST /api/stripe/webhook`.
8. The webhook verifies the signature on the raw body and writes the order
   into the `orders` table. It is idempotent, so a repeated webhook does not
   create a duplicate order.
9. The browser returns to `/checkout/success?session_id=...`.
10. The success page calls `GET /api/checkout/session/:id` to show the real
    amount. Then it clears the cart.

### The security point (say this in the Loom)

**The frontend amount is never trusted.**

- The browser sends only `{ sku, quantity }`.
- The server recomputes price, total, platform fee and merchant share from
  PostgreSQL and Stripe.
- So a user cannot change the price in the browser.

This is enforced in `apps/src/routes/checkout.js` and `apps/src/stripe.js`.

---

## 9. Stage 4 — Stripe Connect marketplace

**Files:** `apps/src/routes/merchants.js`, `apps/src/routes/transfers.js`,
`apps/src/stripe.js`, `database/migrations/up/002_stripe_connect.sql`.

What is implemented:

- Merchants are Stripe **Custom Connected Accounts** created by the platform.
- `POST /api/merchants` creates an account. There is no merchant signup UI.
- `PATCH /api/merchants/:id/status` is a **status simulator**. It switches a
  merchant between `verified`, `failed` and `restricted`.
- Merchant status **gates money**. Destination charges and transfers are both
  blocked unless the merchant status is `verified`.
- `/merchants` shows the list, the status, and the payout gating.

Seed the marketplace (idempotent — creates 3 merchants and assigns products):

```bash
cd apps
npm run seed:marketplace
```

### Honest limitation (say this clearly in the Loom)

Stripe Connect is **not enabled** on the current test platform account. When we
try to create a real connected account, Stripe returns:

> "You can only create new accounts if you've signed up for Connect"

Because of this:

- The app uses simulated merchant accounts with ids like `acct_sim_*`.
- The code detects these fake ids and falls back to `platform_charge` instead
  of trying a destination charge that would fail.
- `apps/src/routes/transfers.js` rejects a transfer to `acct_sim_*` with a
  clear `409 simulated_stripe_account` error.
- Checkout still works end to end. It was verified live: a real Stripe session
  was created with `flow=platform_charge` and a fee.

So the **integration is complete and correct**, but real destination charges
and real transfers need Connect to be enabled on the Stripe account. This is an
account setting, not a code problem.

---

## 10. Stage 4 — Revenue share and fund flows

**File:** `apps/src/stripe.js` — function `calculatePlatformFee`.

The platform fee is one function, used everywhere. It is unit tested. Never a
hardcoded percentage inside a payment flow.

| Order amount | Platform fee |
| ------------ | ------------ |
| Over $100 | 10% |
| $50 – $100 | 15% |
| Under $50 | 20% |

The split is computed on the server-side total in minor units (cents), so the
math is exact integers.

Two fund flows are implemented and documented in `stripe/README.md`:

1. **Destination charges.** When a cart belongs to one `verified` merchant, the
   Checkout Session uses `payment_intent_data.transfer_data` plus
   `application_fee_amount`. The platform keeps its fee immediately. The
   merchant share settles into the connected account. No separate transfer.
2. **Separate charges and transfers.** The charge runs on the platform. The
   merchant share is sent later as a `Transfer`, idempotent per order session.
   The merchant is tagged on the session metadata even for platform charges, so
   a restricted merchant's order can be settled later.

Inspect a paid order with `GET /api/orders/:sessionId`. It returns the Payment
Intent, the computed split, any Transfer, and live platform + connected-account
balances.

---

## 11. End-to-end demo script (the click path)

Run the Loom in this order. It tells the whole story.

1. **Show the repo layout** and the architecture diagram (30s).
2. **Show the scraper**: `scraper/output/products.json`, then `npm test` (1 min).
3. **Show the pipeline**: `dagster/definitions.py` asset order, then the
   Postgres schema in `database/migrations` (1 min).
4. **Show data in Postgres**: 5,047 products, 18 categories, 116 subcategories,
   9,710 images, 4 merchants, 1 order (30s).
5. **Show search typo tolerance**: `GET /api/search?q=landry` returns laundry
   products. Explain ES is optional and Postgres pg_trgm does the fuzzy match
   (1 min).
6. **Show the storefront**: home page, `/products` with filters, a product
   detail page, add to cart (2 min).
7. **Show the cart**, change quantity, go to `/checkout` (1 min).
8. **Pay with test card** `4242 4242 4242 4242`. Show the Stripe page and the
   success page with the real amount (2 min).
9. **Show the webhook order** in the `orders` table, and call
   `GET /api/orders/:sessionId` to show the split (1 min).
10. **Show the merchants page** and the status simulator. Explain payout
    gating (1 min).
11. **Show the admin panel** at `/admin` (30s).
12. **Close with the security note**: the frontend amount is never trusted
    (30s).

Total: about 12–14 minutes.

---

## 12. How to run it locally (current setup)

This is the setup that is currently working. It uses the **local PostgreSQL**
and runs the app from source (no app Docker containers).

### Local PostgreSQL

- Host: `localhost:5432`
- User / password: `postgres` / `postgres`
- `afcommerce` — the catalog (source of truth).
- `afcommerce_cms` — the Payload CMS database.

### Start the API

```bash
cd apps
npm install
npm run dev        # http://localhost:8000
```

### Start the web app

```bash
cd web
npm install
npm run dev        # http://localhost:3000
```

Important: the web dev server uses **port 3000**, even though `web/.env` sets
`PORT=3001`. Do not run `npm start` in `web/` while `npm run dev` is already
running, or you will get a port conflict.

### Environment variables

`apps/.env` (gitignored):

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/afcommerce`
- `ELASTICSEARCH_URL=http://localhost:9200`
- `ELASTICSEARCH_INDEX=products`
- `PORT=8000`
- `WEBAPP_URL=http://localhost:3001`
- `STRIPE_SECRET_KEY=sk_test_...`
- `STRIPE_WEBHOOK_SECRET=whsec_...`
- `CORS_ORIGINS=http://localhost:3000,http://localhost:3001`

`web/.env` (gitignored):

- `PORT=3001`
- `API_URL` / `NEXT_PUBLIC_API_URL=http://localhost:8000`
- `DATABASE_URI=postgresql://postgres:postgres@localhost:5432/afcommerce_cms`
- `PAYLOAD_SECRET=...`
- `PAYLOAD_ADMIN_EMAIL=...` / `PAYLOAD_ADMIN_PASSWORD=...` (not read by config)

Secrets are never committed. `.env` is gitignored; only `.env.example` is
tracked.

### Run with Docker instead

```bash
docker compose up -d --build
```

Services: `database`, `redis`, `elasticsearch`, `kibana`,
`dagster-webserver`, `dagster-daemon`, `scraper`, `api`, `web`.

Right now all containers are stopped. The app is running from source against
local Postgres instead.

---

## 13. Feature status checklist

| Feature | Status | Notes |
| ------- | ------ | ----- |
| Stage 1 scraper | Done | Live API, 5,047 products. |
| Product descriptions | Partial | Source has none; `disclaimer` used, provenance tracked. |
| Product images | Partial | 192 products have no source image. |
| PostgreSQL schema | Done | Migrations 001–003. |
| Dagster pipeline | Done | 4 assets, idempotent, failure handling. |
| Elasticsearch index | Done | Optional at runtime. |
| Postgres fuzzy search | Done | `pg_trgm`, typo tolerant. |
| Backend API | Done | 38/38 tests pass. |
| Storefront pages | Done | Home, products, cart, checkout, merchants. |
| Payload CMS + admin | Done | `/admin` works. |
| Cart | Done | Context + localStorage. |
| Stripe Checkout | Done | Server-side pricing. |
| Stripe webhook + orders | Done | Signature verify + idempotent. |
| Stripe Connect accounts | Partial | Code done; Connect not enabled on the account. |
| Revenue share | Done | One tested function, tier table. |
| Fund flows | Partial | Logic done; real transfers need Connect. |
| CORS | Done | Allowlist middleware. |

---

## 14. Things to say honestly in the Loom

- Elasticsearch is stopped on purpose. Search still works through Postgres
  `pg_trgm`. This shows the fallback design.
- Stripe Connect is not enabled on the test account, so merchants use
  `acct_sim_*` accounts and checkout falls back to `platform_charge`. The code
  is ready for real Connect.
- Product descriptions are empty for most products because the source has no
  description. We do not make up data.
- The Supabase project was tested earlier but is not used now. The app uses
  local Postgres. There are leftover copies of the data in Supabase and an
  empty `afcommerce_cms` database there.
- Local Postgres is fine for the demo. For real deployment, use a hosted or
  managed Postgres. The code is ready for this because `DATABASE_URL` is an
  environment variable and the schema is versioned with migrations.

---

## 15. Quick file reference

| Area | File |
| ---- | ---- |
| API server + CORS | `apps/src/app.js` |
| Search | `apps/src/routes/search.js` |
| ES client | `apps/src/es.js` |
| Products route | `apps/src/routes/products.js` |
| Checkout | `apps/src/routes/checkout.js` |
| Webhook | `apps/src/routes/webhook.js` |
| Merchants | `apps/src/routes/merchants.js` |
| Transfers / orders | `apps/src/routes/transfers.js` |
| Stripe + fees | `apps/src/stripe.js` |
| Marketplace seed | `apps/scripts/seed-marketplace.mjs` |
| DB migrations | `database/migrations/up/001..003` |
| ES mapping | `elasticsearch/mappings/product.index.json` |
| Dagster assets | `dagster/src/` |
| Storefront pages | `web/src/app/(storefront)/` |
| Payload admin | `web/src/app/(payload)/` |
| Payload config | `web/src/payload.config.ts` |
| Cart | `web/src/context/CartContext.tsx` |
| API client | `web/src/lib/api.ts` |

---

## 16. Tests

- Backend API: `cd apps && npm test` → **38/38 pass**.
- Scraper: `cd scraper && npm test` → 9 tests.
- Elasticsearch query builder: 11 tests.
- Dagster: 16 pytest tests.
- Web type check: `cd web && npx tsc --noEmit` → clean.

---

## 17. Live data counts (local Postgres)

- Products: 5,047
- Categories: 18
- Subcategories: 116
- Product images: 9,710
- Merchants: 4
- Orders: 1
- CMS users: 1
