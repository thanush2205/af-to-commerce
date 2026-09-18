# Deploying AFTO Commerce to Render + Vercel

This guide explains, step by step, how to put the whole project online:

- **Render** — hosts the Node.js API (`apps/`).
- **Vercel** — hosts the Next.js + Payload storefront (`web/`).
- **Render Postgres (or Neon)** — the catalog database.
- **Elastic Cloud (or Bonsai)** — the search index, with the PostgreSQL
  fallback always available.
- **Stripe** — Checkout + webhook.

Everything stays driven by environment variables. No secrets are committed.

---

## 1. Target architecture

```text
                        Browser (customer)
                              |
                 +------------+-------------+
                 |                          |
          https://storefront.vercel.app   https://api..onrender.com
                 |  (Next.js + Payload)     |  (Node.js Express API)
                 |                          |
            Payload DB                 catalog DB (afcommerce)
            (afcommerce_cms)          + Elastic Cloud (search, optional)
                 |                          |
                 +-------------+------------+
                       Stripe (Checkout + webhook)
```

Two platforms, three data stores, one payment provider. The API is a
long-running service, so it belongs on **Render**. The web app is Next.js
full-stack with Payload admin, so it belongs on **Vercel**.

Why the web app works on Vercel:

- Pages fetch product data **server-side** from the API using `API_URL`.
- Checkout is a client component that calls the API with
  `NEXT_PUBLIC_API_URL`.
- Payload's admin runs inside Next.js (`web/src/app/(payload)/`).

---

## 2. Prerequisites

Accounts needed:

1. GitHub repo (you already have `git` initialized).
2. **Render** — free or paid. https://render.com
3. **Vercel** — free. https://vercel.com
4. **Elastic Cloud** — free trial. https://cloud.elastic.co (or Bonsai.io)
5. **Stripe** — test mode. https://dashboard.stripe.com
6. A Postgres host for the Payload CMS DB — the same Render Postgres instance
   can hold **two databases** (`afcommerce` + `afcommerce_cms`).

---

## 3. Small code prep (recommended before deploying)

Three tiny, safe changes make deployment turn-key. You can ask me to make
them.

### 3.1 Let Payload create its schema in production

`web/src/payload.config.ts` line 41 currently reads:

```ts
push: isDev,
```

Change it to:

```ts
push: process.env.PAYLOAD_PUSH === 'true' || isDev,
```

Then set `PAYLOAD_PUSH=true` in the Vercel project during the first deploy.
Payload will create its tables in `afcommerce_cms` on first boot, and you turn
the flag off afterwards. This avoids creating migration files by hand.

### 3.2 One command to apply catalog migrations

Add a tiny migration runner for the catalog database so you can apply
`database/migrations/up/001..003.sql` to the hosted Postgres without `psql`:

`apps/scripts/migrate.mjs` — connect with `pg`, read the `up/` files in order,
run each inside a transaction, and remember what was applied. Then add:

```json
"migrate": "node scripts/migrate.mjs"
```

to `apps/package.json`.

### 3.3 `render.yaml` blueprint (optional)

Lets you deploy the API with one click instead of clicking through the UI.
The full file is in section 10.

---

## 4. Step 1 — Create the databases

### Option A — Supabase (recommended for this project)

This project already runs on Supabase: the catalog (schema + 5,047 products +
`pg_trgm`) lives in the `postgres` database, and Payload's schema is pushed
into `afcommerce_cms`. So when Supabase is chosen you can **skip the migration
step and the data-load step entirely**.

Use the **transaction pooler** URI (transaction mode = port 6543):

- API catalog DB (`DATABASE_URL`):
  `postgresql://postgres.<project-ref>:<DB_PASSWORD>@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres`
- Payload CMS DB (`DATABASE_URI`):
  `postgresql://postgres.<project-ref>:<DB_PASSWORD>@aws-0-ap-southeast-2.pooler.supabase.com:6543/afcommerce_cms`

Get the pooler host + password from the Supabase dashboard (**Connect →
Connection string → Transaction**). Set `PG_SSL=true` for the API and
`PAYLOAD_SSL=true` for Payload — Supabase requires TLS.

Notes:

- The direct host (`db.<ref>.supabase.co:5432`) may be unreachable from some
  networks; the pooler on 6543 is the reliable path.
- Free Supabase projects pause after ~7 days of inactivity.
- You can still run `cd apps && npm run migrate` against a *fresh* hosted
  database anytime — the runner tracks applied files in a `_migrations` table.

### Option B — Render Postgres (same provider)

1. In Render: **New → PostgreSQL**.
2. Name: `afcommerce-db`. Choose a region close to you. Use a paid plan during
   the demo if you do not want the DB to sleep — the free plan pauses after
   15 minutes of inactivity and expires after 30 days.
3. After creation, open **Info** and copy the **Internal Database URL** and
   **External Database URL**.
4. Create the second database (Payload). SQLPad or your local `psql`:

   ```bash
   psql "<external-database-url>/afcommerce" -c "CREATE DATABASE afcommerce_cms;"
   ```

Now you have:

- `<RENDER_URL>/afcommerce` → catalog + orders (used by the API).
- `<RENDER_URL>/afcommerce_cms` → Payload CMS (used by Vercel).

### Option C — Neon (Vercel-friendly, always-on free tier)

1. Create a Neon project, grab the connection string (it already ends with
   the database name `neondb`).
2. Create the two databases with the Neon SQL editor:

   ```sql
   CREATE DATABASE afcommerce;
   CREATE DATABASE afcommerce_cms;
   ```

Use the public (pooled) URL for Vercel and for the API. Render and Neon both
support `pg_trgm`, which migration 003 needs.

---

## 5. Step 2 — Apply the catalog migrations

On the `afcommerce` database, run the three `up/` migrations **in order**:

- `database/migrations/up/001_create_catalog_schema.sql`
- `database/migrations/up/002_stripe_connect.sql`
- `database/migrations/up/003_pg_trgm_search.sql`

With the migration runner from 3.2:

```bash
cd apps
DATABASE_URL="<external-db-url>/afcommerce" npm run migrate
```

Or manually with `psql`:

```bash
psql "<external-db-url>/afcommerce" -f database/migrations/up/001_create_catalog_schema.sql
psql "<external-db-url>/afcommerce" -f database/migrations/up/002_stripe_connect.sql
psql "<external-db-url>/afcommerce" -f database/migrations/up/003_pg_trgm_search.sql
```

Check it worked:

```bash
psql "<external-db-url>/afcommerce" -c "\dt"          # expect 6 tables
psql "<external-db-url>/afcommerce" -c "SELECT * FROM pg_extension WHERE extname='pg_trgm';"
```

> `afcommerce_cms` is handled by Payload itself (section 8), not these
> migrations.

---

## 6. Step 3 — Deploy the API to Render

1. In Render: **New → Web Service**. Connect the GitHub repo.
2. Settings:
   - **Name:** `af-commerce-api`
   - **Region:** same as your Postgres
   - **Root Directory:** `apps`
   - **Build Command:** `npm ci && npm run test`
   - **Start Command:** `npm start`
     (Do NOT use `npm run dev` — the deployment must run `node src/server.js`.)
   - **Health Check Path:** `/healthz` (the API serves it at `apps/src/server.js`)
   - **Instance Type:** free tier works; a paid instance for a smooth demo.
3. **Environment** — add:

   | Variable | Value |
   | -------- | ----- |
   | `DATABASE_URL` | `<external-db-url>/afcommerce` |
   | `ELASTICSEARCH_URL` | Elastic Cloud endpoint (section 7) |
   | `ELASTICSEARCH_INDEX` | `products` |
   | `ELASTICSEARCH_API_KEY` | Elastic Cloud API key (section 7) |
   | `STRIPE_SECRET_KEY` | `sk_test_...` |
   | `STRIPE_WEBHOOK_SECRET` | from the Stripe webhook (section 9) |
   | `CORS_ORIGINS` | `https://<your-storefront>.vercel.app,http://localhost:3000` |
   | `PORT` | `8000` |
   | `APP_ENV` | `production` |

   Notes:

   - `CORS_ORIGINS` must include every domain that will call the API from the
     browser: the Vercel storefront URL (and localhost for testing).
   - Set `ELASTICSEARCH_URL` and `ELASTICSEARCH_API_KEY` even if the index is
     not loaded yet — the API tries Elasticsearch first, fails fast (2 s
     timeout), and falls back to PostgreSQL. Search works either way.

4. Deploy. When it is live, confirm:

   ```bash
   curl https://<api>.onrender.com/healthz
   curl "https://<api>.onrender.com/api/search?q=chips&limit=3"
   curl "https://<api>.onrender.com/api/products?limit=3"
   ```

   The search may return PostgreSQL results until Elasticsearch is indexed —
   that is the designed fallback, not an error.

---

## 7. Step 4 — Hosted Elasticsearch

Render has no managed Elasticsearch, so we use a hosted one. Two cheap options:

- **Elastic Cloud** (recommended): https://cloud.elastic.co
  - Create a deployment (free trial gives the essentials). Region close to
    your users.
  - Open **Kibana → Stack Management → API keys** and create an API key.
  - Copy the Elasticsearch endpoint (ends in `.elastic.co:443`) — this is
    `ELASTICSEARCH_URL`.
- **Bonsai.io**: a small paid cluster; endpoint + API key in the dashboard.

Security: always use the HTTPS endpoint with an API key or
user/password pair. The API client `apps/src/es.js` already supports the
`apiKey` auth type.

### Load the index (one time)

From your machine, after the API lands:

```bash
cd elasticsearch
npm install
ELASTICSEARCH_URL="https://<id>.elastic.co:443" \
ELASTICSEARCH_API_KEY="<api-key>" \
  npm run ensure-index          # creates the "products" index (idempotent)

ELASTICSEARCH_URL="https://<id>.elastic.co:443" \
ELASTICSEARCH_API_KEY="<api-key>" \
  npm run index-products        # bulk-loads scraper/output/products.json
```

The loader uses `_id = sku`, so re-running never duplicates.

Confirm from the deployed API:

```bash
curl "https://<api>.onrender.com/api/search?q=landry"   # fuzzy hits after ES is live
```

> The site stays up even if Elasticsearch is paused or removed later, because
> the API silently falls back to PostgreSQL `pg_trgm`. This is a feature to
> mention in the Loom.

---

## 8. Step 5 — Load the catalog data

You already have the full dataset locally (5,047 products). Copy it once:

```bash
# From your machine, with the local Postgres running:
pg_dump --data-only --no-owner --no-privileges -d afcommerce | psql "<external-db-url>/afcommerce"
```

The dump includes products, categories, subcategories, product_images,
merchants and the order ledger. Foreign-key order is preserved automatically.

Verify on the cloud database:

```bash
psql "<external-db-url>/afcommerce" -c "SELECT count(*) FROM products;"   # 5047
psql "<external-db-url>/afcommerce" -c "SELECT count(*) FROM merchants;"  # 4
```

> Alternative, repeatable path: run the Dagster pipeline against the cloud
> hosts (see section 11). The dump is the fastest way for a demo.

---

## 9. Step 6 — Deploy the web app to Vercel

1. In Vercel: **Add New → Project**. Import the same GitHub repo.
2. Root Directory: `web`.
3. Vercel auto-detects Next.js. Build command stays `npm run build`; the
   project's build script already sets the memory flag.
4. **Environment Variables:**

   | Variable | Value |
   | -------- | ----- |
   | `API_URL` | `https://<api>.onrender.com` |
   | `NEXT_PUBLIC_API_URL` | `https://<api>.onrender.com` |
   | `DATABASE_URI` | `<external-db-url>/afcommerce_cms` |
   | `PAYLOAD_SECRET` | a long random string |
   | `PAYLOAD_PUSH` | `true` (first deploy only — see 3.1) |

   Note: `API_URL` is the server-side base (Vercel functions call it).
   `NEXT_PUBLIC_API_URL` is the browser base. Both are the same Render URL
   here. Vercel builds are public HTTPS, so no private network is needed.

5. Deploy. On first visit to `/admin`, Payload asks you to create the first
   admin user (email + password). That becomes your login. (The known local
   user `thanushreddy934@gmail.com` is only in your local `afcommerce_cms`.)
6. After the first admin is created, go to Vercel → Settings → Environment
   Variables and set `PAYLOAD_PUSH=false`, then redeploy. The schema now stays
   managed.

Verify the storefront:

- `https://<storefront>.vercel.app/` — home (hero, categories, featured).
- `https://<storefront>.vercel.app/products` — listing + search.
- `https://<storefront>.vercel.app/merchants` — merchant page.
- `https://<storefront>.vercel.app/admin` — Payload admin login.

---

## 10. Step 7 — Stripe Checkout + webhook

1. In `apps/.env` you already have a test key. Use the same key on Render:
   `STRIPE_SECRET_KEY=sk_test_...`.
2. Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
   - URL: `https://<api>.onrender.com/api/stripe/webhook`
   - Events: `checkout.session.completed` (and optionally
     `payment_intent.succeeded`).
3. Copy the **Signing secret** (`whsec_...`) into the API's
   `STRIPE_WEBHOOK_SECRET`.
4. Test the flow: add to cart → `/checkout` → Stripe hosted page → pay with
   `4242 4242 4242 4242` (any future expiry and CVC) → success page.
5. Confirm the order landed:

   ```bash
   curl https://<api>.onrender.com/api/orders/<session_id>
   ```

   It returns the Payment Intent, the revenue split and the balances.

The webhook route is mounted before the JSON body parser in
`apps/src/app.js`, so signature verification works over TLS exactly as it does
locally.

> **Connect reminder:** destination charges and transfers are coded but read
> `verified` merchants. Your Stripe account must be enrolled in **Connect** for
> those to become live; until then merchants stay `acct_sim_*` and checkout
> falls back to `platform_charge` — tested and working.

---

## 11. What about Dagster?

Dagster is the **offline ingestion** pipeline, not a customer-facing feature.
Nothing on the site needs it at runtime. Two honest options:

- **MVP (recommended):** keep Dagster local/CI. Load the data once (section 8)
  and index once (section 7). Deployment is then just API + web + DBs + ES.
- **Full pipeline on Render:** add a **Background Worker** service
  (`dagster-webserver` + daemon) using a `dagster/` Docker image, and run
  `dagster asset materialize -f /workspace/definitions.py --select ...` on a
  schedule. This costs extra instances and is overkill for a demo. If you want
  it, make a `dagster/Dockerfile` and point the worker at GitHub — I can write
  it for you.

---

## 12. Optional: one-click API deploy with `render.yaml`

Put this at the **repo root** and Render will create the API service for you:

```yaml
services:
  - type: web
    name: af-commerce-api
    runtime: node
    rootDir: apps
    plan: free
    buildCommand: npm ci && npm run test
    startCommand: npm start
    healthCheckPath: /healthz
    envVars:
      - key: PORT
        value: '8000'
      - key: DATABASE_URL
        sync: false              # set in the Render dashboard
      - key: ELASTICSEARCH_URL
        sync: false
      - key: ELASTICSEARCH_INDEX
        value: products
      - key: ELASTICSEARCH_API_KEY
        sync: false
      - key: STRIPE_SECRET_KEY
        sync: false
      - key: STRIPE_WEBHOOK_SECRET
        sync: false
      - key: CORS_ORIGINS
        sync: false
```

---

## 13. Deploy checklist (click this in the demo)

1. `curl https://<api>.onrender.com/healthz` → ok.
2. `curl https://<api>.onrender.com/api/products?limit=3` → 3 products.
3. `https://<storefront>.vercel.app/` → home page loads.
4. `/products?q=landry` → laundry results (Postgres or ES).
5. Cart → `/checkout` → Stripe page → pay with `4242...` → success.
6. `curl https://<api>.onrender.com/api/orders/<session_id>` → split shown.
7. `/merchants` → merchants + status.
8. `/admin` → Payload login.

---

## 14. Costs and honest limits

| Piece | Free? | Note |
| ----- | ----- | ---- |
| Render Web Service | Yes | Sleeps after 15 min idle on free plan. |
| Render Postgres | Free tier | Pauses after inactivity, expires in 30 days. |
| Neon Postgres | Yes | Also a good Vercel-native choice. |
| Elastic Cloud | Trial | Small deployment; site survives if it lapses. |
| Vercel | Yes | Serverless; fine for this workload. |
| Stripe | Yes | Test mode. |

Things that bite people:

- Render free services sleep → the first request after idle is slow. For the
  demo, keep a browser tab parked on each URL, or use a paid instance.
- `CORS_ORIGINS` must contain the exact Vercel domain or checkout will fail
  from the browser (add after the web app gets its URL).
- Vercel env changes need a **redeploy** to take effect.
- Payload schema push should be **off** in production once the tables exist.
- Elasticsearch is optional — PostgreSQL search covers you if it is down.

---

## 15. Quick reference — env vars

`apps/` (Render API):

```text
PORT=8000
DATABASE_URL=<external-db>/afcommerce
ELASTICSEARCH_URL=https://<id>.elastic.co:443
ELASTICSEARCH_INDEX=products
ELASTICSEARCH_API_KEY=<apikey>
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
CORS_ORIGINS=https://<storefront>.vercel.app,http://localhost:3000
APP_ENV=production
```

`web/` (Vercel):

```text
API_URL=https://<api>.onrender.com
NEXT_PUBLIC_API_URL=https://<api>.onrender.com
DATABASE_URI=<external-db>/afcommerce_cms
PAYLOAD_SECRET=<random>
PAYLOAD_PUSH=false
```