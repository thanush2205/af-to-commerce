# Elasticsearch Query Examples

Index: `products` · API base: `http://localhost:9200`

All examples use the raw ES DSL so they map 1:1 to the assessment's required
features. The Node package wraps these in `buildProductSearchQuery()` /
`runSearch()` (`elasticsearch/src/search.js`), which the API uses.

---

## 0. Verify the cluster is up

```bash
curl -s http://localhost:9200/_cluster/health
# {"status":"yellow|green","number_of_nodes":1,...}
```

## 1. Full-text search on `name` + `description` (boosted name)

`multi_match` against `name` (boosted `^3`) and `description`, with `AUTO`
fuzziness so typos still match.

```bash
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "from": 0,
  "size": 10,
  "track_total_hits": true,
  "query": {
    "bool": {
      "must": {
        "multi_match": {
          "query": "apple juice",
          "fields": ["name^3", "description"],
          "type": "best_fields",
          "fuzziness": "AUTO"
        }
      }
    }
  },
  "sort": [ { "_score": { "order": "desc" } } ]
}'
```

## 2. Category filter (exact match)

`category` is mapped as a `keyword`, so filtered with a `term` query — no
tokenization surprises.

```bash
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "size": 25,
  "query": {
    "bool": {
      "must": { "match_all": {} },
      "filter": [ { "term": { "category": "Beverages" } } ]
    }
  }
}'
```

## 3. Full-text + filters combined (bool must/filter)

Search "organic juice" inside Beverages, in stock, priced $1–$10.

```bash
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "query": {
    "bool": {
      "must": {
        "multi_match": {
          "query": "organic juice",
          "fields": ["name^3", "description"],
          "type": "best_fields",
          "fuzziness": "AUTO"
        }
      },
      "filter": [
        { "term": { "category": "Beverages" } },
        { "term": { "availability": "in_stock" } },
        { "range": { "price": { "gte": 1, "lte": 10 } } }
      ]
    }
  }
}'
```

## 4. Price sorting (ascending / descending)

```bash
# ascending
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "query": { "match_all": {} },
  "sort": [ { "price": { "order": "asc", "missing": "_last" } } ]
}'

# descending
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "query": { "match_all": {} },
  "sort": [ { "price": { "order": "desc", "missing": "_last" } } ]
}'
```

## 5. Name sorting (normalized keyword sub-field)

```bash
# "name" is text; "name.keyword" is the lowercase-normalized, sortable field
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "query": { "match_all": {} },
  "sort": [ { "name.keyword": { "order": "asc" } } ]
}'
```

## 6. Pagination

`from` + `size`. Page 1 is `from: 0`; page 2 is `from: 25` with `size: 25`.

```bash
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "from": 25,
  "size": 25,
  "track_total_hits": true,
  "query": { "match_all": {} }
}'
```

## 7. Aggregation: category counts for filter facets

```bash
curl -s -X POST "http://localhost:9200/products/_search" -H 'Content-Type: application/json' -d'
{
  "size": 0,
  "query": { "bool": { "must": { "match_all": {} }, "filter": [ { "term": { "availability": "in_stock" } } ] } },
  "aggs": {
    "by_category": { "terms": { "field": "category", "size": 20 } }
  }
}'
```

Emphasis on the architecture point for the Loom: Postgres stays the source of
truth (writes, transactions, uniqueness). Elasticsearch is the read/search
index populated from it. Indexing is idempotent (`_id` = product `sku`), so a
re-run of the ingestion never creates duplicates.