/**
 * GET /api/categories — category tree with live product/subcategory counts,
 * ready for storefront navigation.
 */

import { Router } from "express";
import { query } from "../db.js";
import { asyncHandler } from "../util.js";

export const categoriesRouter = Router();

categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const [categoriesResult, subcategoriesResult] = await Promise.all([
      query(`
        SELECT
          c.id, c.name, c.slug, c.image_url,
          count(DISTINCT s.id)::int AS subcategory_count,
          count(DISTINCT p.id) FILTER (WHERE p.is_active)::int AS product_count
        FROM categories c
        LEFT JOIN subcategories s ON s.category_id = c.id
        LEFT JOIN products p ON p.subcategory_id = s.id
        GROUP BY c.id
        ORDER BY c.name ASC, c.id ASC
      `),
      query(`
        SELECT
          s.id, s.name, s.slug, c.id AS category_id,
          count(DISTINCT p.id) FILTER (WHERE p.is_active)::int AS product_count
        FROM subcategories s
        JOIN categories c ON c.id = s.category_id
        LEFT JOIN products p ON p.subcategory_id = s.id
        GROUP BY s.id, c.id
        ORDER BY c.name ASC, s.name ASC, s.id ASC
      `),
    ]);

    const children = new Map();
    for (const row of subcategoriesResult.rows) {
      const bucket = children.get(row.category_id) || [];
      bucket.push({
        id: Number(row.id),
        name: row.name,
        slug: row.slug,
        productCount: row.product_count,
      });
      children.set(row.category_id, bucket);
    }

    const data = categoriesResult.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      slug: row.slug,
      imageUrl: row.image_url,
      subcategoryCount: row.subcategory_count,
      productCount: row.product_count,
      subcategories: children.get(row.id) || [],
    }));

    res.json({ data, count: data.length });
  }),
);