import test from "node:test";
import assert from "node:assert/strict";
import { shapeProduct } from "../src/routes/products.js";

const ROW = {
  id: 123,
  name: "Field Greens",
  slug: "field-greens",
  description: "Crisp local greens.",
  description_source: "homesome",
  price: "4.99",
  currency: "CAD",
  sku: "UPC-000123",
  availability: "in_stock",
  brand: "Ontario Farms",
  organic: true,
  unit: "g",
  unit_quantity: "280",
  min_quantity: "1",
  max_quantity: "10",
  main_image: "https://cdn/img.jpg",
  thumbnail: "https://cdn/thumb.jpg",
  category_name: "Produce",
  category_slug: "produce",
  subcategory_name: "Salad Greens",
  subcategory_slug: "salad-greens",
};

test("shapeProduct maps a DB row to the storefront JSON shape", () => {
  const product = shapeProduct(ROW);
  assert.equal(product.id, 123);
  assert.equal(product.price, 4.99);
  assert.equal(product.organic, true);
  assert.equal(product.unitQuantity, 280);
  assert.equal(product.minQuantity, 1);
  assert.equal(product.category.name, "Produce");
  assert.equal(product.subcategory.slug, "salad-greens");
  assert.deepEqual(product.category, { name: "Produce", slug: "produce" });
  assert.equal("images" in product, false);
});

test("shapeProduct adds an images array only when requested", () => {
  const product = shapeProduct(ROW, { includeImages: true });
  assert.deepEqual(product.images, []);
});

test("shapeProduct tolerates null optional numerics", () => {
  const product = shapeProduct({
    ...ROW,
    unit: null,
    unit_quantity: null,
    min_quantity: null,
    max_quantity: null,
    brand: null,
  });
  assert.equal(product.unitQuantity, null);
  assert.equal(product.minQuantity, null);
  assert.equal(product.maxQuantity, null);
  assert.equal(product.brand, null);
});