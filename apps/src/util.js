/**
 * Small shared helpers: async error handling, HTTP errors, pagination parsing
 * and numeric coercion. Kept dependency-free so the unit tests stay fast.
 */

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || `http_${status}`;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}

/**
 * Page/limit from a request query:
 *   ?page=2&limit=50  ->  { page: 2, limit: 50, offset: 50 }
 * Invalid or missing values fall back to page 1 / the default limit.
 */
export function parsePagination(query, defaults = {}) {
  const limit = clamp(
    Math.floor(Number(query.limit) || defaults.limit || 20),
    1,
    100,
  );
  const page = clamp(
    Math.floor(Number(query.page) || 1),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  return { page, limit, offset: (page - 1) * limit };
}

export function totalPages(total, limit) {
  return Math.max(1, Math.ceil(total / limit));
}

export function paginationMeta(total, page, limit) {
  return {
    total,
    page,
    limit,
    pages: totalPages(total, limit),
  };
}

/** Blank string / undefined / null -> undefined so URL params stay honest. */
export function optionalString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
}

export function optionalNumber(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}