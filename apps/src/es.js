/**
 * Elasticsearch client + search query helpers (derived search index).
 *
 * The query builder mirrors `elasticsearch/src/search.js` so the two sections
 * stay behaviorally identical: full-text match on name^3 + description with
 * best_fields fuzziness, exact-term filters, price/name/relevance sorting and
 * from/size pagination.
 */

import { Client } from "@elastic/elasticsearch";
import { config } from "./config.js";

export const client = new Client({
  node: config.elasticsearch.url,
  auth: config.elasticsearch.apiKey
    ? { apiKey: config.elasticsearch.apiKey }
    : undefined,
});

export const FULL_TEXT_FIELDS = ["name^3", "description"];

/**
 * Open a connection to Elasticsearch at boot so the first user search does not
 * pay TLS/connection setup inside the 2s request budget. Non-fatal: when ES is
 * down the pool stays empty and searches fall back to PostgreSQL.
 */
export async function warmUpElasticsearch(timeoutMs = 2000) {
  try {
    await client.ping({ requestTimeout: timeoutMs });
    console.log("[es] connection warm - search will use Elasticsearch");
    return true;
  } catch {
    console.log("[es] warmup skipped - search will fall back to PostgreSQL");
    return false;
  }
}

export function buildSearchBody({
  q,
  category,
  subcategory,
  availability,
  organic,
  minPrice,
  maxPrice,
  sort = "relevance",
  order = "desc",
  from = 0,
  size = 10,
} = {}) {
  const filters = [];

  if (category) filters.push({ term: { category } });
  if (subcategory) filters.push({ term: { subcategory } });
  if (availability) filters.push({ term: { availability } });
  if (organic !== undefined && organic !== null && organic !== "") {
    filters.push({ term: { organic: Boolean(organic) } });
  }
  if (minPrice !== undefined && minPrice !== null && minPrice !== "") {
    filters.push({ range: { price: { gte: Number(minPrice) } } });
  }
  if (maxPrice !== undefined && maxPrice !== null && maxPrice !== "") {
    filters.push({ range: { price: { lte: Number(maxPrice) } } });
  }

  const query =
    q && q.trim()
      ? {
          multi_match: {
            query: q.trim(),
            fields: FULL_TEXT_FIELDS,
            type: "best_fields",
            fuzziness: "AUTO",
          },
        }
      : { match_all: {} };

  return {
    from: Number(from) || 0,
    size: Number(size) || 10,
    track_total_hits: true,
    query: { bool: { filter: filters, must: query } },
    sort: buildSort(sort, order),
  };
}

function buildSort(sort, order) {
  const direction = order === "asc" ? "asc" : "desc";
  switch (sort) {
    case "price":
      return [{ price: { order: direction, missing: "_last", unmapped_type: "double" } }];
    case "name":
      return [{ "name.keyword": { order: direction, missing: "_last", unmapped_type: "keyword" } }];
    default:
      return [{ _score: { order: direction } }];
  }
}

const DISPLAY_FIELDS = [
  "id",
  "sku",
  "slug",
  "name",
  "description",
  "price",
  "currency",
  "category",
  "subcategory",
  "brand",
  "organic",
  "availability",
  "thumbnail",
  "mainImage",
  "images",
];

export function translateHits(body, result) {
  const rawTotal = result.hits.total;
  const total =
    typeof rawTotal === "number" ? rawTotal : (rawTotal && rawTotal.value) || 0;

  const hits = result.hits.hits.map((hit) => {
    const source = hit._source ?? {};
    const record = {};
    for (const field of DISPLAY_FIELDS) {
      if (field in source) record[field] = source[field];
    }
    record.score =
      typeof hit._score === "number" ? Number(hit._score.toFixed(4)) : null;
    return record;
  });

  return {
    total,
    page: { from: body.from, size: body.size },
    hits,
  };
}

export async function runSearch(body, { requestTimeout } = {}) {
  const result = await client.search(
    { index: config.elasticsearch.index, body },
    { requestTimeout },
  );
  return translateHits(body, result);
}