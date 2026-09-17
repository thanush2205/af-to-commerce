# Section 6 — Backend API (Node.js)

The bridge between the storefront and the databases:

```
Storefront (Next.js)
      │
      ▼
   Node.js API  ──► PostgreSQL    (catalog, source of truth)
      │
      └─────────► Elasticsearch   (full-text search, derived index)
```

Spec-aligned endpoints. All responses are JSON with a consistent
`{ data, pagination }` envelope (or `{ error: { code, message } }` on failure).

| Endpoint                                  | What it does |
| ----------------------------------------- | ------------ |
| `GET /api/products`                       | PostgreSQL catalog listing (filter + sort + paginate) |
| `GET /api/products/:id`                   | Single product by numeric `id`, `slug` or `sku` (includes `images`) |
| `GET /api/categories`                     | Category tree with subcategory + product counts |
| `GET /api/search`                         | Elasticsearch full-text search |
| `GET /healthz`                            | Liveness probe (used by the compose healthcheck) |

### `/api/products` — query params

- `category` — match by slug **or** name (`snacks-and-treats` / `Snacks & Treats`)
- `subcategory` — same, by slug or name
- `sort` — `name_asc` (default) · `name_desc` · `price_asc` · `price_desc` · `newest`
- `page`, `limit` — pagination (`limit` clamped to 1..100, default 20)

### `/api/search` — query params

- `q` — full-text, fuzzy `best_fields` over `name^3` + `description`
- `category`, `subcategory`, `availability`, `organic`, `minPrice`, `maxPrice` — exact filters
- `sort` — `relevance` (default) · `price` · `name` or combined shorthand `price_asc`/`price_desc`/`name_asc`/`name_desc`
- `order` — `asc` / `desc` (for the separate-param spelling)
- `page`, `limit`

Search results use the same display fields as the Search section
(`id, sku, slug, name, description, price, currency, category, subcategory,
brand, organic, availability, thumbnail, mainImage, images, score`).

## Layout

```
apps/
├── Dockerfile            # node:20-alpine, npm ci, CMD node src/server.js
├── .dockerignore         # excludes test/ + docs from the image
├── src/
│   ├── server.js         # HTTP listener + graceful shutdown
│   ├── app.js            # Express app (logging, routes, 404, error handler)
│   ├── config.js         # env-driven config (DATABASE_URL, ELASTICSEARCH_URL/INDEX/API_KEY)
│   ├── db.js             # pg connection pool
│   ├── es.js             # Elasticsearch client + search query builder (mirrors Search section)
│   ├── util.js           # pagination, HttpError, coercions
│   └── routes/
│       ├── products.js   # /api/products[/:id]   (PostgreSQL)
│       ├── categories.js # /api/categories       (PostgreSQL)
│       └── search.js     # /api/search           (Elasticsearch)
└── test/                 # node --test unit + in-process HTTP tests
```

## Run it

```bash
docker compose up -d --build api          # pinned to the internal Postgres + ES
docker compose exec -T api npm test       # 19 unit tests
curl http://localhost:8000/healthz
curl "http://localhost:8000/api/products?category=snacks-and-treats&limit=5"
curl "http://localhost:8000/api/categories"
curl "http://localhost:8000/api/search?q=chips&sort=price_asc&page=1&limit=20"
```

Or without Docker (from `apps/`, with a reachable Postgres/ES):

```bash
cd apps
npm install
DATABASE_URL=postgresql://... ELASTICSEARCH_URL=... npm run dev
```

## Notes / tradeoffs

- **Postgres is queried for listing/detail; Elasticsearch for search.** The API
  keeps the two sources in their intended roles instead of duplicating data.
- **Security:** the dockerized Elasticsearch runs with security disabled
  (`xpack.security.enabled: "false"`), so **no API key is needed locally**. For
  a secured deployment (e.g. Elastic Cloud) set `ELASTICSEARCH_URL` to the
  deployment endpoint and `ELASTICSEARCH_API_KEY` — the client already sends it
  when present.
- **The API is pinned to the compose-internal Postgres** (`DATABASE_URL` is
  overridden in docker-compose.yml). The host `.env` may point at an external
  Supabase that the container network can't reach — the same pinning the Dagster
  section uses.
- Errors are always JSON; 5xx never leaks stack traces in production.