# Loom Video — Narration Script (10–15 min)

Use this as your exact script. Each section shows **what to say** (narration)
and **what to show on screen** (screen cue). Total time approx. 13–14 minutes.
Speak slowly and clearly; the tone is calm and professional.

Estimated pacing: ~140 words per minute.

---

## 0. Intro and agenda (0:00 – 0:40)

**Screen:** the loaded storefront home page.

**Narration:**

"Hello, and welcome to AFTO Commerce. This is a small online grocery
marketplace I built end to end.

In the next few minutes I will show you four things.
First, the high-level architecture and the decisions behind it.
Second, the Dagster ingestion workflow that moves the product data in.
Third, how search works — both in Elasticsearch and the fallback.
And finally, the Stripe checkout flow and how the money is split with the
merchants.

Let me start with a quick live demo, then go under the hood."

---

## 1. Quick demo (0:40 – 2:30)

**Screen:** click around the store. Home page -> Products list -> click a
product -> add to cart.

**Narration:**

"This is the customer view. The whole catalog is real: I did not type products
in by hand. A scraper copied about five thousand products from the Summerhill
Market online catalog into a JSON file.

Here on the products page you can search, filter by category, and sort by
price. Let me search for 'chips' ... you can see the results come back fast,
and I can sort them from low to high.

Each product page shows the price, the unit, availability, and the category
it belongs to. I will add a product to the cart.

When I check out, the customer is taken to a Stripe-hosted payment page. I
will use Stripe's test card, 4242 4242 4242 4242. After payment, the page
confirms the order.

Now let me explain how all of this is built."

---

## 2. Architecture decisions (2:30 – 4:30)

**Screen:** the architecture diagram from the README.

**Narration:**

"The system has four main parts.

First, the data chain. The scraper writes a products.json file. Dagster reads
that file, cleans the data, and loads it into PostgreSQL. PostgreSQL is the
source of truth — the single place that owns all products, categories,
merchants, and orders.

Second, Elasticsearch is built from the same pipeline as a search index. It is
a derived index, not a source of truth. I rebuilt it from Dagster, never from
hand edits.

Third, the Node.js API in the apps folder serves the catalog, the search, and
the Stripe checkout. The storefront never talks to the databases directly.

Fourth, the storefront is Next.js with the Payload CMS. The public pages read
from the API, and the CMS admin at /admin lets content be edited through the
same PostgreSQL database.

The most important decision is that money amounts are never trusted from the
browser. The browser only sends which items and how many. The API re-reads
every price from the database, calculates the total, the platform fee, and the
merchant share on the server. This single rule is why the revenue split stays
correct.

Another decision: the Stripe webhook is mounted before the JSON body parser.
Stripe signs the exact bytes it sent. So the webhook reads the raw body, and
only after the signature is verified is the order recorded."

---

## 3. Dagster workflow (4:30 – 6:30)

**Screen:** Dagster UI asset graph (raw -> normalized -> Postgres ->
Elasticsearch). Then the normalized JSON file.

**Narration:**

"Let me show the Dagster pipeline in detail, because this is the heart of the
ingestion.

There are four assets in one job called catalog_ingestion.

The first asset, raw_products, reads the products.json file created by the
scraper. It reports how many products it found.

The second asset, normalized_products, transforms the data. The scraper output
is grouped by category and subcategory. This step flattens every product into
one clean record: it fixes currencies, rounds prices, turns strings into
booleans, and creates a URL-safe slug for every product. Names are not always
unique in a real grocery catalog, so when two products get the same slug, the
normalizer appends a number like dash 2, dash 3. This is deterministic, so the
same input always gives the same output.

The third asset, postgres_products, writes everything into PostgreSQL inside a
single database transaction. This is what makes reruns safe. Every write uses
upserts on natural keys: categories on their slug, products on their SKU. If
you run the pipeline again, rows are updated in place. Nothing is duplicated.
And because it is one transaction, if any statement fails, the whole batch
rolls back. No partial state.

The fourth asset, elasticsearch_products, bulk-indexes the same products into
Elasticsearch with the product SKU as the document id. A rerun replaces the
documents instead of adding duplicates.

There is also a daily 3 a.m. schedule, which I registered but left stopped, so
the system does not run it without being asked.

And the pipeline is tested. There are pytest tests for the transform logic and
contract tests that check every SQL upsert really has an ON CONFLICT clause."

---

## 4. PostgreSQL schema (6:30 – 7:30)

**Screen:** the migration file 001_create_catalog_schema.sql.

**Narration:

"Briefly, the database schema. There are three core tables.

Categories sit at the top. Each category has several subcategories. And each
subcategory has many products. Products also keep their images in a separate
table, product_images.

Every natural key has a unique constraint: category slug, the combination of
category and subcategory, and the product SKU. Those constraints are exactly
what the Dagster upserts rely on.

For performance, I added indexes on the hot query paths: products by category,
products by subcategory, products by price, and a combined index on category
and price, which is what the storefront filter-sort pattern uses. There is
also an updated_at trigger on every table, so we always know when a row last
changed."

---

## 5. Search design and live Elasticsearch queries (7:30 – 10:00)

**Screen:** the terminal running curl examples against the products index.

**Narration:**

"Now the search design, with live examples.

The storefront sends a query to the API as /api/search. The API tries
Elasticsearch first. If Elasticsearch is slow or unavailable, it falls back to
PostgreSQL and returns the exact same response shape, so the page cannot tell
the difference.

In Elasticsearch, name and description are text fields, which means they are
analyzed for full-text matching. Category, subcategory, availability are
keyword fields, which are exact. Price is a number, so it can be sorted and
filtered by range.

A full-text search uses a match query on the name. Let me run the first
example: search for 'naan' on the name field. Results come back with a
relevance score.

For search on descriptions, I use a match query on the description field.

For a combined query, I use multi_match over both fields and boost the name by
two, so the product name matters more than the description.

Filtering by category is a term query on the category keyword. One detail:
the storefront filters by slug — like dry-goods-and-baking — but Elasticsearch
stores the display name — like Dry Goods and Baking. So the API resolves the
slug to the stored name before running the term query. That is why the filter
always matches.

Sorting by price is a sort clause on the price field. Here is a combined
query: match 'chips', filter to the Snacks category, with a price range of two
to eight dollars, sorted from high to low.

For typo tolerance, I add fuzziness AUTO. Let me search 'landry' — it still
finds laundry. That mirrors the login the search fallback uses in PostgreSQL.

And finally, a terms aggregation counts products per category, which would
power a filter sidebar.

If Elasticsearch ever times out, the PostgreSQL fallback does an ILIKE search
and, when nothing matches exactly, it retries with a fuzzy trigram similarity,
so even the fallback understands 'landry'."

---

## 6. Stripe revenue flow (10:00 – 13:00)

**Screen:** the checkout flow diagram; then the checkout page; then the
webhook logs in the API terminal; then a query of the orders table.

**Narration:**

"For payments, I used Stripe Checkout and Stripe Connect.

Here is the flow. The customer has a cart. The page calls POST /api/checkout
with only the items and quantities. No amounts.

The API loads each product from PostgreSQL, checks the stock, and builds the
line items from the server-side prices. It also computes the platform fee. The
platform keeps a percentage of the order: twenty percent under fifty dollars,
fifteen percent between fifty and a hundred, ten percent above a hundred.
That percentage comes from one tested function used everywhere, so no part of
the flow can disagree with another.

Stripe returns a hosted checkout page. The customer pays with the test card.

After payment, Stripe sends a webhook event checkout.session.completed to our
endpoint. The API verifies the signature against the signing secret. It only
then writes an order row into the orders table — with the total, the platform
amount, and the merchant amount. The write is idempotent: if Stripe re-sends
the same event, it does nothing.

Let me show the orders table now. Here is the recorded test order with its
split: total, platform fee, merchant share.

On the merchant side I implemented two Connect flows. When a cart belongs to
one verified merchant, the checkout uses a destination charge: the customer
pays, the platform fee is taken immediately, and the merchant share settles
into the merchant's Stripe balance — no separate transfer needed.

When the cart is a platform sale, the charge runs on the platform and the
merchant share is pushed later as an idempotent Transfer keyed to the order
session.

Merchants are gated by status. A merchant must be verified before any money
can move, using the status simulator to test verified, failed, and restricted
merchants.

One honest caveat. The live platform account does not have Stripe Connect
enabled yet, so the merchants use simulation accounts. Orders, fees, and
splits are all real and correct, but an actual merchant transfer returns a
409 until I activate Connect."

---

## 7. Deployment, limits, and wrap-up (13:00 – 14:30)

**Screen:** the Render service page; then the Vercel project; brief.

**Narration:**

"For deployment, the API runs on Render and the storefront runs on Vercel.
Both read from the same Supabase PostgreSQL database. Elasticsearch runs on
Elastic Cloud, with the API key stored only in environment variables, never in
the repository. The deployment steps are documented in the repository under
docs/DEPLOYMENT.md.

Two limits to be transparent about. These are free-tier services, so Render
and Supabase can go to sleep after inactivity, and the first request may be
slow. Also, about ninety-six percent of the source catalog products have no
description, so those products show the price and the unit but a blank
description.

To summarize. A scraper collects a real catalog. Dagster cleans it and loads
it into a PostgreSQL source of truth and an Elasticsearch search index. A
Node.js API serves catalog, search, and payments. A Next.js storefront sells
the products through Stripe, with the revenue split controlled server-side.
Pricing is never trusted from the browser, every pipeline step can re-run
safely, and search degrades gracefully.

Thank you for watching."

---

## Timing checklist

| Section | Topic | Time |
| ------- | ----- | ---- |
| 0 | Intro and agenda | 0:00 – 0:40 |
| 1 | Quick live demo | 0:40 – 2:30 |
| 2 | Architecture decisions | 2:30 – 4:30 |
| 3 | Dagster workflow | 4:30 – 6:30 |
| 4 | PostgreSQL schema | 6:30 – 7:30 |
| 5 | Search design + Elasticsearch queries | 7:30 – 10:00 |
| 6 | Stripe revenue flow | 10:00 – 13:00 |
| 7 | Deployment, limits, wrap-up | 13:00 – 14:30 |

## Files to open during the video

- `README.md` — architecture diagram (§2), Search design (§5), Stripe flow (§6)
- `dagster/` — Dagster UI asset graph, `src/assets.py`, `src/normalize.py`
- `database/migrations/up/001_create_catalog_schema.sql` — schema (§4)
- `elasticsearch/query-examples.md` — the search queries (§5)
- `apps/src/stripe.js` — `calculatePlatformFee`, Connect flows (§6)
- `apps/src/routes/webhook.js` — signature verification + order recording (§6)
- `docs/DEPLOYMENT.md` — Render + Vercel + Supabase + Elastic Cloud (§7)