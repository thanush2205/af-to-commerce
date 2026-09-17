import { test } from "node:test";
import assert from "node:assert/strict";

import { buildProductSearchQuery, translateHits } from "../src/search.js";

test("full-text search boosts name over description", () => {
  const body = buildProductSearchQuery({ q: "apple juice" });
  assert.deepEqual(body.query.bool.must, {
    multi_match: {
      query: "apple juice",
      fields: ["name^3", "description"],
      type: "best_fields",
      fuzziness: "AUTO",
    },
  });
  assert.ok(Array.isArray(body.query.bool.filter));
  assert.equal(body.query.bool.filter.length, 0);
});

test("no query falls back to match_all", () => {
  const body = buildProductSearchQuery({ sort: "price", order: "asc" });
  assert.deepEqual(body.query.bool.must, { match_all: {} });
});

test("category filter is an exact term on the keyword field", () => {
  const body = buildProductSearchQuery({ category: "Beverages" });
  assert.deepEqual(body.query.bool.filter, [{ term: { category: "Beverages" } }]);
});

test("combined filters (category + availability + price range)", () => {
  const body = buildProductSearchQuery({
    category: "Beverages",
    availability: "in_stock",
    minPrice: 1,
    maxPrice: 10,
  });
  assert.deepEqual(body.query.bool.filter, [
    { term: { category: "Beverages" } },
    { term: { availability: "in_stock" } },
    { range: { price: { gte: 1 } } },
    { range: { price: { lte: 10 } } },
  ]);
});

test("boolean organic filter", () => {
  const body = buildProductSearchQuery({ organic: true });
  assert.deepEqual(body.query.bool.filter, [{ term: { organic: true } }]);
});

test("empty organic does not add a filter", () => {
  const body = buildProductSearchQuery({ organic: "" });
  assert.equal(body.query.bool.filter.length, 0);
});

test("price sort asc with missing last", () => {
  const body = buildProductSearchQuery({ sort: "price", order: "asc" });
  assert.deepEqual(body.sort, [
    { price: { order: "asc", missing: "_last", unmapped_type: "double" } },
  ]);
});

test("name sort uses normalized keyword sub-field", () => {
  const body = buildProductSearchQuery({ sort: "name", order: "asc" });
  assert.deepEqual(body.sort, [
    { "name.keyword": { order: "asc", missing: "_last", unmapped_type: "keyword" } },
  ]);
});

test("default sort is relevance score desc", () => {
  const body = buildProductSearchQuery({});
  assert.deepEqual(body.sort, [{ _score: { order: "desc" } }]);
});

test("pagination from/size are passed through", () => {
  const body = buildProductSearchQuery({ q: "bread", from: 20, size: 10 });
  assert.equal(body.from, 20);
  assert.equal(body.size, 10);
});

test("translateHits maps _source and score and reports total", () => {
  const result = {
    hits: {
      total: { value: 42 },
      hits: [
        {
          _score: 3.7192834,
          _source: {
            id: "x",
            sku: "x",
            name: "Organic Apple Juice",
            price: 6.99,
            category: "Beverages",
            images: ["a.jpg", "b.jpg"],
            notMapped: "ignored",
          },
        },
      ],
    },
  };
  const translated = translateHits({ from: 0, size: 10 }, result);
  assert.equal(translated.total, 42);
  assert.equal(translated.hits.length, 1);
  assert.equal(translated.hits[0].name, "Organic Apple Juice");
  assert.equal(translated.hits[0].score, 3.7193);
  assert.deepEqual(translated.hits[0].images, ["a.jpg", "b.jpg"]);
  assert.equal(translated.hits[0].notMapped, undefined);
});