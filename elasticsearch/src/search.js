/**
 * Product search query builder + runner.
 *
 * Supports the three required features plus the usual commerce affordances:
 *  - full-text search on `name` (boosted) and `description`
 *  - exact filters: category, subcategory, availability, organic, price range
 *  - sorting: relevance (_score), price asc/desc, name asc/desc
 *  - pagination via from/size
 */

const FULL_TEXT_FIELDS = ["name^3", "description"];

export function buildProductSearchQuery({
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

  const query = q && q.trim()
    ? {
        multi_match: {
          query: q.trim(),
          fields: FULL_TEXT_FIELDS,
          type: "best_fields",
          fuzziness: "AUTO",
        },
      }
    : { match_all: {} };

  const body = {
    from: Number(from) || 0,
    size: Number(size) || 10,
    track_total_hits: true,
    query: { bool: { filter: filters, must: query } },
    sort: buildSort(sort, order),
  };

  return body;
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
  const total =
    typeof result.hits.total === "number"
      ? result.hits.total
      : result.hits.total?.value ?? 0;

  const hits = result.hits.hits.map((hit) => {
    const source = hit._source ?? {};
    const record = {};
    for (const field of DISPLAY_FIELDS) {
      if (field in source) record[field] = source[field];
    }
    record.score = typeof hit._score === "number" ? Number(hit._score.toFixed(4)) : null;
    return record;
  });

  return {
    total,
    page: { from: body.from, size: body.size },
    hits,
  };
}

export async function runSearch(client, index, options = {}) {
  const body = buildProductSearchQuery(options);
  const result = await client.search({ index, body });
  return translateHits(body, result);
}