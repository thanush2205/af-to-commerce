# Summerhill Market Catalog Scraper

Scrapes the full Summerhill Market online grocery catalog (`https://shop.summerhillmarket.com/`) and emits a structured `products.json`.

## How the site actually works (mandatory inspection first)

The storefront is a WordPress site whose product data is **not server-rendered and not in the HTML**. All product, category, search and PDP data is loaded at runtime from the **Homesome partner API** through a small wrapper (`var hsdata` + `HomesomeAPI` class exposed on every page):

- API base: `https://user-api.gethomesome.com`
- Auth: `apikey` request header (the site embeds the key on every page)
- Catalog: `GET /product/list?listType=ui` → returns the **entire catalog (5,047 products) in one response**
- Detail: `GET /product?name=<upc>` → richer fields per product
- Locations: `GET /locations` (per-store currency / price lists)

Because the source is API-driven, this scraper uses HTTP + JSON parsing only. **No HTML parsing (Cheerio) and no headless browser (Playwright) are required** — the catalog payload already contains everything the frontend needs, including images and availability.

## Output format

`products.json` is an array of category/subcategory groups:

```json
[
  {
    "category": "Snacks & Treats",
    "subcategory": "Candies",
    "products": [
      {
        "id": "830028001457",
        "name": "Pur Sugar-Free Bubble Gum 9 pieces",
        "description": "",
        "price": 1.99,
        "currency": "CAD",
        "sku": "830028001457",
        "brand": "Pur",
        "organic": false,
        "unit": "count",
        "unitQuantity": 1,
        "minQuantity": 0,
        "maxQuantity": 0,
        "availability": "in_stock",
        "images": [
          "https://s3-us-west-2.amazonaws.com/www.gethomesome.com/productimages/summerhillmarket-830028001457-d6d46.jpg",
          "https://s3-us-west-2.amazonaws.com/www.gethomesome.com/productimages_tn/summerhillmarket-830028001457-d6d46.jpg"
        ],
        "mainImage": "https://s3-us-west-2.amazonaws.com/www.gethomesome.com/productimages/summerhillmarket-830028001457-d6d46.jpg",
        "thumbnail": "https://s3-us-west-2.amazonaws.com/www.gethomesome.com/productimages_tn/summerhillmarket-830028001457-d6d46.jpg",
        "category": "Snacks & Treats",
        "subcategory": "Candies",
        "descriptionSource": "none"
      }
    ]
  }
]
```

Alongside it, `summary.json` records the run: product count, category/subcategory counts, image coverage, availability, timestamps and run id.

## Requirements

- Node.js ≥ 20 (tested on 24)
- Network access to `user-api.gethomesome.com`

## Setup

```bash
# From the repository root: copy the env template
cp .env.example .env        # PowerShell: Copy-Item .env.example .env

cd scraper
npm install
```

The scraper reads its configuration from the repository-root `.env` (it loads `../../.env`). It needs `HOMESOME_API_KEY` (and optionally `HOMESOME_API_BASE_URL`). A working public key is pre-seeded from the site, but treat it as a secret-controlled value you can rotate at any time.

## Rerun instructions

```bash
# Full scrape → scraper/output/products.json + summary.json
npm run scrape

# Full scrape with explicit output directory
npm run scrape -- --out ./output

# Smoke test with a product limit
npm run scrape -- --limit 50

# Run unit tests
npm test
```

Runs are **safe to repeat**:
- The API is read-only; the scraper performs no writes on the source.
- Every run overwrites the previous `products.json` atomically (temp file + rename), so a crash mid-write never corrupts the last good file.
- No caching is involved, so each run reflects the current live catalog.

## Behaviour requirements

| Requirement | How it is handled |
| --- | --- |
| **Pagination** | The source API returns the full catalog in a single unpaginated response (`/product/list`). There is no next-page token or page size on the source — verified against the live API. The scraper therefore does one catalog request; no iteration is needed. Documented here as a verified source behaviour rather than invented pagination. |
| **Lazy loading** | N/A — images are referenced by URL in the JSON payload, not lazy-loaded into HTML. |
| **Nested categories** | `type` (category) and `subType` (subcategory) are first-class fields; the output groups products by both. There is no deeper nesting in the source. |
| **Retry logic** | Exponential backoff with jitter (1s → 2s → 4s → 8s), applied to network errors, HTTP 5xx and 429. Tuned via `SCRAPER_MAX_RETRIES` / `SCRAPER_RETRY_BASE_DELAY_MS`. |
| **Error handling** | Failures are logged as structured JSON (timestamp, message, stack); the process exits non-zero on a fatal error. All writes are atomic. |
| **No hardcoded data** | Zero products are hardcoded. Every record is derived from a live API response. Only configuration (base URL, retry tuning, currency) is static by design. |

## Field mapping and assumptions

| Output field | Source | Assumption |
| --- | --- | --- |
| `id` / `sku` | `upc` | UPC is present on all 5,047 products and is the site's own join key (`name` in the API equals the UPC). There is no separate SKU field on the source, so UPC is used for both. |
| `name` | `displayName` | Human-readable product title. |
| `price` | `price` | Catalog price in the store's currency. |
| `currency` | `SCRAPER_CURRENCY` (default `CAD`) | Summerhill is a Canadian retailer; `GET /locations` reports `currency: "cad"` for all stores. Override via env if a per-store price list is used. |
| `images` | `mainImage` + the S3 URL pattern the site itself uses | Full + thumbnail URLs are reconstructed. `mainImage` is an opaque key (e.g. `summerhillmarket-...-8003a`), 192/5047 products have none. |
| `description` | `disclaimer`, when present | **The source exposes no product description anywhere** — not in the catalog, not in `GET /product?name=<id>`, not in the PDP HTML (which contains a literal `{product}` placeholder), not in the embedded PDP app. To avoid fabricating content, `description` maps the real `disclaimer` text when available (177/5047) and `descriptionSource` records provenance (`disclaimer` / `none`) so downstream consumers can distinguish authored vs. missing text. |
| `availability` | `isInStock`, `availableToOrder`, `reasonUnavailable` | `in_stock` / `out_of_stock` / `unavailable` derived from the source flags. |
| `category` / `subcategory` | `type` / `subType` | Verified: 18 categories, 116 category/subcategory pairs. |

### Tradeoffs

- **Description**: see above. If a richer description ever appears in the source (e.g. the embed app adds one), `descriptionOf()` is the single place to extend — the agent added an `ingredients` note in the detail endpoint as the likeliest future source.
- **Full catalog, single request**: robust but returns ~3.8 MB per run; fine for a 24h assessment, and the retry layer covers the rare mid-transfer failure.
- **API key**: public by design on the source website (used by every visitor's browser); it is wired through `.env` so repos stay clean and rotation is a one-line change.

## Directory layout

```
scraper/
├── src/
│   ├── index.js      # entry point / orchestration
│   ├── config.js     # env-driven config + validation
│   ├── logger.js     # structured JSON logger
│   ├── http.js       # axios wrapper with exponential backoff
│   ├── api.js        # Homesome API endpoints
│   ├── transform.js  # raw API → product records, grouping, summary
│   └── write.js      # atomic JSON writes
├── test/             # node:test unit tests
├── output/           # generated products.json / summary.json (gitignored)
└── Dockerfile        # containerised scraper for docker-compose
```

## Running in Docker

```bash
# From the repository root
docker compose build scraper
docker compose run --rm scraper
```