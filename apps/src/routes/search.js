/**
 * GET /api/search — full-text product search.
 *
 * Elasticsearch is the primary engine (derived search index). When it is
 * unreachable or too slow (e.g. a demo laptop without it running), the request
 * falls back to the PostgreSQL source of truth with the SAME result shape, so
 * the storefront never breaks:
 *
 *   /api/search?q=chips  -> ES multi_match  OR  PG name/description ILIKE
 *
 * Supported params (identical for both engines):
 *   ?category=  ?subcategory=  ?availability=  ?organic=  ?minPrice=  ?maxPrice=
 *   ?sort=relevance|price|name  (+ ?order=asc|desc or shorthand price_asc, ...)
 *   ?page=&limit=
 *
 * The response mirrors the search-section `translateHits` shape exactly, so the
 * frontend can treat `/api/search` and `/api/products` interchangeably.
 */

import { Router } from "express";
import { buildSearchBody, runSearch } from "../es.js";
import { query } from "../db.js";
import { asyncHandler, optionalNumber, optionalString, parsePagination, paginationMeta } from "../util.js";
import { shapeProduct } from "./products.js";

export const searchRouter = Router();

// Budget for the Elasticsearch call before falling back to PostgreSQL.
// Tune via env (cloud endpoints + TLS need more headroom than localhost).
const ES_REQUEST_TIMEOUT_MS = Number(process.env.ES_REQUEST_TIMEOUT_MS) || 2000;

const SORT_KEYS = new Set(["relevance", "price", "name"]);
const ORDER_KEYS = new Set(["asc", "desc"]);

// Accepts both spellings the assignment used:
//   ?sort=price_asc            (combined shorthand)
//   ?sort=price&order=asc      (separate params)
const SHORTHAND_SORTS = new Map([
  ["price_asc", { sort: "price", order: "asc" }],
  ["price_desc", { sort: "price", order: "desc" }],
  ["name_asc", { sort: "name", order: "asc" }],
  ["name_desc", { sort: "name", order: "desc" }],
]);

/* ---------------------------------------------------------------------------
 * PostgreSQL fallback (source of truth) — identical response shape to ES.
 * ------------------------------------------------------------------------- */

const PG_FIELDS = `
  p.id, p.sku, p.slug, p.name, p.description, p.description_source,
  p.price, p.currency, p.brand, p.organic, p.availability,
  p.unit, p.unit_quantity, p.min_quantity, p.max_quantity,
  p.main_image, p.thumbnail,
  c.name AS category_name, c.slug AS category_slug,
  s.name AS subcategory_name, s.slug AS subcategory_slug`;

const PG_JOINS = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN subcategories s ON s.id = p.subcategory_id`;

// Trigram similarity threshold (0..1). 0.4 is lenient enough for a single
// transposition ("landry" -> "laundry", sim 0.5) without pulling in noise.
const TRGM_THRESHOLD = 0.4;

// pg_trgm is optional (migration 003); check once and cache. Without it the
// search still works, just without typo tolerance.
let trgmAvailable;
async function trgmEnabled() {
  if (trgmAvailable !== undefined) return trgmAvailable;
  try {
    const result = await query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    trgmAvailable = result.rowCount > 0;
  } catch {
    trgmAvailable = false;
  }
  return trgmAvailable;
}

export async function searchPg({
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
  // Non-query filters are shared by the exact and fuzzy passes.
  const filters = ["p.is_active = true"];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (optionalString(category)) {
    const p = add(category);
    filters.push(`(lower(c.slug) = lower(${p}) OR lower(c.name) = lower(${p}))`);
  }
  if (optionalString(subcategory)) {
    const p = add(subcategory);
    filters.push(`(lower(s.slug) = lower(${p}) OR lower(s.name) = lower(${p}))`);
  }
  if (optionalString(availability)) {
    filters.push(`p.availability = ${add(availability)}`);
  }
  if (organic !== undefined && organic !== null && organic !== "") {
    filters.push(`p.organic = ${add(Boolean(organic))}`);
  }
  if (optionalNumber(minPrice) !== undefined) {
    filters.push(`p.price >= ${add(Number(minPrice))}`);
  }
  if (optionalNumber(maxPrice) !== undefined) {
    filters.push(`p.price <= ${add(Number(maxPrice))}`);
  }

  const qq = optionalString(q);
  // Single query param, referenced by BOTH passes (as `'%' || $n || '%'`) so
  // every placeholder is always bound exactly once per statement.
  const qRef = qq ? add(qq) : null;
  const qExact = qRef
    ? `(p.name ILIKE '%' || ${qRef} || '%' OR p.description ILIKE '%' || ${qRef} || '%')`
    : null;

  const run = async (qPredicate, fuzzy) => {
    const whereSql = [...filters, ...(qPredicate ? [qPredicate] : [])].join(" AND ");
    const direction = order === "asc" ? "ASC" : "DESC";
    let pgSort;
    switch (sort) {
      case "price":
        pgSort = `p.price ${direction}, p.id ASC`;
        break;
      case "name":
        pgSort = `p.name ${direction}, p.id ASC`;
        break;
      default:
        // Relevance: rank by trigram similarity to the query (best first)
        // when fuzzy matching; otherwise a stable alphabetical order.
        pgSort =
          fuzzy && qRef
            ? `word_similarity(${qRef}, p.name) DESC, p.name ASC, p.id ASC`
            : "p.name ASC, p.id ASC";
    }

    const countResult = await query(
      `SELECT count(*)::int AS total ${PG_JOINS} WHERE ${whereSql}`,
      params,
    );
    const result = await query(
      `SELECT ${PG_FIELDS} ${PG_JOINS} WHERE ${whereSql}
       ORDER BY ${pgSort} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, from],
    );

    return {
      total: countResult.rows[0].total,
      hits: result.rows.map((row) => ({
        ...shapeProduct(row, { includeImages: true }),
        score: null,
      })),
    };
  };

  // Pass 1 — exact substring match. This keeps counts precise.
  const exact = await run(qExact, false);
  if (!qq || exact.total > 0) return exact;

  // Pass 2 — "did you mean": nothing matched exactly, so try typo tolerance
  // (pg_trgm). "landry" -> "... Laundry ...". Requires migration 003.
  if (await trgmEnabled()) {
    const fuzzyPredicate = `${qExact} OR word_similarity(${qRef}, p.name) > ${TRGM_THRESHOLD}`;
    const fuzzy = await run(fuzzyPredicate, true);
    if (fuzzy.total > 0) return fuzzy;
  }

  return exact;
}

/* ---------------------------------------------------------------------------
 * Route — ES first (2s cap), Postgres fallback on any failure.
 * ------------------------------------------------------------------------- */

searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const shorthand = SHORTHAND_SORTS.get(String(req.query.sort || ""));
    const sort = shorthand
      ? shorthand.sort
      : SORT_KEYS.has(String(req.query.sort || "relevance"))
        ? String(req.query.sort)
        : "relevance";
    const order = shorthand
      ? shorthand.order
      : ORDER_KEYS.has(String(req.query.order || "desc"))
        ? String(req.query.order)
        : "desc";

    const { page, limit, offset } = parsePagination(req.query);

    const opts = {
      q: optionalString(req.query.q),
      category: optionalString(req.query.category),
      subcategory: optionalString(req.query.subcategory),
      availability: optionalString(req.query.availability),
      organic: optionalString(req.query.organic),
      minPrice: optionalNumber(req.query.minPrice),
      maxPrice: optionalNumber(req.query.maxPrice),
      sort,
      order,
      from: offset,
      size: limit,
    };

    const body = buildSearchBody(opts);

    let result;
    try {
      result = await runSearch(body, { requestTimeout: ES_REQUEST_TIMEOUT_MS });
    } catch (err) {
      console.warn(
        `[search] Elasticsearch unavailable (${err.message}) — falling back to PostgreSQL`,
      );
      result = await searchPg(opts);
    }

    res.json({
      data: result.hits,
      pagination: paginationMeta(result.total, page, limit),
    });
  }),
);