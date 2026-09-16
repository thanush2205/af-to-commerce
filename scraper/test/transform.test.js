import test from "node:test";
import assert from "node:assert/strict";
import {
  availabilityOf,
  descriptionOf,
  groupByCategoryAndSubcategory,
  toProduct,
} from "../src/transform.js";

test("availabilityOf: in stock when nothing contradicts it", () => {
  assert.equal(availabilityOf({ isInStock: true, availableToOrder: true, reasonUnavailable: "" }), "in_stock");
});

test("availabilityOf: out_of_stock when isInStock is false", () => {
  assert.equal(availabilityOf({ isInStock: false, availableToOrder: true }), "out_of_stock");
});

test("availabilityOf: out_of_stock when availableToOrder is false", () => {
  assert.equal(availabilityOf({ isInStock: true, availableToOrder: false }), "out_of_stock");
});

test("availabilityOf: unavailable when a reason exists", () => {
  assert.equal(
    availabilityOf({ isInStock: true, availableToOrder: true, reasonUnavailable: "seasonal" }),
    "unavailable"
  );
});

test("descriptionOf: uses disclaimer when present and marks provenance", () => {
  const { description, descriptionSource } = descriptionOf({ disclaimer: "  Refrigerate after opening.  " });
  assert.equal(description, "Refrigerate after opening.");
  assert.equal(descriptionSource, "disclaimer");
});

test("descriptionOf: empty description flagged as none", () => {
  const { description, descriptionSource } = descriptionOf({ disclaimer: "   " });
  assert.equal(description, "");
  assert.equal(descriptionSource, "none");
});

test("toProduct: maps id/sku from upc and builds image URLs", () => {
  const raw = {
    name: "091037550460",
    displayName: "Heritage Eggs XL 1 Dozen",
    type: "Dairy & Eggs",
    subType: "Eggs",
    upc: "091037550460",
    brand: "Heritage Breeds",
    price: 10.99,
    mainImage: "summerhillmarket-091037550460-8003a",
    unit: "count",
    unitQuantity: 1,
  };
  const p = toProduct(raw);
  assert.equal(p.id, "091037550460");
  assert.equal(p.sku, "091037550460");
  assert.equal(p.name, "Heritage Eggs XL 1 Dozen");
  assert.equal(p.price, 10.99);
  assert.equal(p.category, "Dairy & Eggs");
  assert.equal(p.subcategory, "Eggs");
  assert.equal(p.images.length, 2);
  assert.match(p.images[0], /productimages\/summerhillmarket-091037550460-8003a\.jpg$/);
  assert.match(p.images[1], /productimages_tn\/summerhillmarket-091037550460-8003a\.jpg$/);
});

test("toProduct: empty image list when no mainImage", () => {
  const p = toProduct({ upc: "123", displayName: "No image item" });
  assert.deepEqual(p.images, []);
  assert.equal(p.mainImage, null);
});

test("groupByCategoryAndSubcategory: groups and sorts deterministically", () => {
  const products = [
    { ...toProduct({ upc: "1", displayName: "B", type: "Snacks", subType: "Chips", price: 5 }) },
    { ...toProduct({ upc: "2", displayName: "A", type: "Snacks", subType: "Chips", price: 2 }) },
    { ...toProduct({ upc: "3", displayName: "C", type: "Dairy", subType: "Milk", price: 3 }) },
  ];
  const groups = groupByCategoryAndSubcategory(products);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => `${g.category}/${g.subcategory}`),
    ["Dairy/Milk", "Snacks/Chips"]
  );
  assert.deepEqual(
    groups[1].products.map((p) => p.price),
    [2, 5]
  );
});