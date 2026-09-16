# af-to-commerce

Mini grocery commerce platform. Scrapes the Summerhill Market online catalog, ingests it via Dagster into PostgreSQL + Elasticsearch, serves it through a Node.js API and a Next.js/Payload storefront with Stripe checkout and a Stripe Connect marketplace.

## Architecture

```text
Summerhill Market (Homesome API)
        ↓
scraper/           → products.json
        ↓
dagster/           → PostgreSQL (source of truth) + Elasticsearch (search index)
        ↓
apps/api/          → Node.js API (products, search, checkout)
        ↓
apps/web/          → Next.js + Payload CMS storefront
        ↓
stripe/            → Checkout + Stripe Connect marketplace
```

| Directory        | Responsibility                                        |
| ---------------- | ----------------------------------------------------- |
| `apps/`          | Next.js + Payload storefront and Node.js API           |
| `scraper/`       | Summerhill catalog scraper → `products.json` (Stage 1, DONE) |
| `dagster/`       | Data orchestration & scheduling (assets/jobs)         |
| `database/`      | Database schemas, migrations, seed data               |
| `elasticsearch/` | Index mappings, queries                               |
| `stripe/`        | Stripe billing, checkout & Stripe Connect             |

## Stage 1 — Product scraper (DONE)

Inspects the live source: `shop.summerhillmarket.com` is a WordPress front-end backed by the **Homesome API** (`https://user-api.gethomesome.com`, `apikey` header). All product data is API-driven — no HTML scraping or headless browser needed.

- `GET /product/list?listType=ui` → full catalog (5,047 products, one unpaginated response)
- `GET /product?name=<upc>` → per-product detail endpoint
- Images reconstructed from the site's own S3 pattern; category = `type`, subcategory = `subType`
- Source exposes **no product description** → mapped from real `disclaimer` text, provenance tracked in `descriptionSource` (documented assumption)

Rerun:

```bash
cd scraper
npm install
npm run scrape     # → scraper/output/products.json (+ summary.json)
npm test           # 9 unit tests
```

See [scraper/README.md](scraper/README.md) for full behaviour matrix, field mapping, rerun instructions and assumptions.

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- Node.js ≥ 20 (for the scraper)

## Configuration

All configuration is driven by environment variables — copy `.env.example` to `.env` and review. The scraper reads the root `.env` (`HOMESOME_API_KEY` etc.).

## Development

- Scraper → Dagster → PostgreSQL + Elasticsearch → Node API → Next.js storefront → Stripe
- Dagster schedules scrape + enrichment pipelines
- Stripe webhooks handled in `stripe/`, synced to the database

## License

Proprietary.