/**
 * GET /api/products — PostgreSQL catalog listing with category/subcategory
 * filters, sorting and pagination.
 * GET /api/products/:id — single product by numeric id, slug or sku.
 */

import { Router } from "express";
import { query } from "../db.js";
import { HttpError, asyncHandler, optionalString, parsePagination, paginationMeta } from "../util.js";

export const productsRouter = Router();

const PHANTOM = "p";

const ORDER_BY = {
  name_asc: "p.name ASC, p.id ASC",
  name_desc: "p.name DESC, p.id ASC",
  price_asc: "p.price ASC, p.id ASC",
  price_desc: "p.price DESC, p.id ASC",
  newest: "p.created_at DESC, p.id DESC",
  default: "p.name ASC, p.id ASC",
};

const LIST_FIELDS = `
  p.id, p.name, p.slug, p.description, p.description_source,
  p.price, p.currency, p.sku, p.availability, p.brand, p.organic,
  p.unit, p.unit_quantity, p.min_quantity, p.max_quantity,
  p.main_image, p.thumbnail, p.created_at, p.updated_at,
  c.name AS category_name, c.slug AS category_slug,
  s.name AS subcategory_name, s.slug AS subcategory_slug`;

const LIST_JOINS = `
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN subcategories s ON s.id = p.subcategory_id
  WHERE p.is_active = true`;

const FILTERS = `
  AND ($1::text IS NULL OR lower(c.slug) = lower($1) OR lower(c.name) = lower($1))
  AND ($2::text IS NULL OR lower(s.slug) = lower($2) OR lower(s.name) = lower($2))`;

/** Normalize a product row into the storefront-facing shape. */
export function shapeProduct(row, { includeImages = false } = {}) {
  const product = {
    id: Number(row.id),
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    description: row.description || "",
    descriptionSource: row.description_source,
    price: Number(row.price),
    currency: row.currency,
    brand: row.brand,
    organic: row.organic,
    availability: row.availability,
    unit: row.unit,
    unitQuantity: row.unit_quantity !== null ? Number(row.unit_quantity) : null,
    minQuantity: row.min_quantity !== null ? Number(row.min_quantity) : null,
    maxQuantity: row.max_quantity !== null ? Number(row.max_quantity) : null,
    mainImage: row.main_image,
    thumbnail: row.thumbnail,
    category: { name: row.category_name, slug: row.category_slug },
    subcategory: { name: row.subcategory_name, slug: row.subcategory_slug },
  };
  if (includeImages) product.images = [];
  return product;
}

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const category = optionalString(req.query.category);
    const subcategory = optionalString(req.query.subcategory);
    const { page, limit, offset } = parsePagination(req.query);
    const orderBy =
      ORDER_BY[optionalString(req.query.sort) || "default"] || ORDER_BY.default;

    const whereParams = [category || null, subcategory || null];

    const countResult = await query(
      `SELECT count(*)::int AS total ${LIST_JOINS} ${FILTERS}`,
      whereParams,
    );
    const total = countResult.rows[0].total;

    const result = await query(
      `SELECT ${LIST_FIELDS} ${LIST_JOINS} ${FILTERS} ORDER BY ${orderBy} LIMIT $3 OFFSET $4`,
      [...whereParams, limit, offset],
    );

    res.json({
      data: result.rows.map((row) => shapeProduct(row)),
      pagination: paginationMeta(total, page, limit),
    });
  }),
);

productsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const lookup = req.params.id;
    const isId = /^\d+$/.test(lookup);

    let row;
    if (isId) {
      const result = await query(
        `SELECT ${LIST_FIELDS} ${LIST_JOINS} AND p.id = $1`,
        [Number(lookup)],
      );
      row = result.rows[0];
    } else {
      const result = await query(
        `SELECT ${LIST_FIELDS} ${LIST_JOINS} AND (p.slug = $1 OR p.sku = $1)`,
        [lookup],
      );
      row = result.rows[0];
    }

    if (!row) {
      throw new HttpError(404, `Product not found: ${lookup}`, "product_not_found");
    }

    const imagesResult = await query(
      "SELECT id, image_url, position, kind FROM product_images WHERE product_id = $1 ORDER BY position ASC, id ASC",
      [row.id],
    );

    const product = shapeProduct(row, { includeImages: true });
    product.images = imagesResult.rows.map((img) => ({
      id: Number(img.id),
      url: img.image_url,
      position: img.position,
      kind: img.kind,
    }));
    res.json({ data: product });
  }),
);