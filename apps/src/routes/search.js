/**
 * GET /api/search — Elasticsearch full-text product search.
 *
 * Supports, on top of plain `q`:
 *   ?category=        exact keyword filter
 *   ?subcategory=     exact keyword filter
 *   ?availability=    in_stock | out_of_stock | unavailable
 *   ?organic=true|false
 *   ?minPrice=&maxPrice=
 *   ?sort=relevance|price|name  (- ascending / descending via ?order=asc|desc)
 *   ?page=&limit=     pagination (limit <= 100)
 *
 * The result shape mirrors the Search-section `translateHits` output exactly,
 * so the frontend treats `/api/search` and `/api/products` interchangeably.
 */

import { Router } from "express";
import { buildSearchBody, runSearch } from "../es.js";
import { asyncHandler, optionalNumber, optionalString, parsePagination, paginationMeta } from "../util.js";

export const searchRouter = Router();

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

    const body = buildSearchBody({
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
    });

    const result = await runSearch(body);

    res.json({
      data: result.hits,
      pagination: paginationMeta(result.total, page, limit),
    });
  }),
);