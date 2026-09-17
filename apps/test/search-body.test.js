import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchBody, translateHits } from "../src/es.js";

test("plain q becomes a boosted multi_match with fuzziness", () => {
  const body = buildSearchBody({ q: "chips", size: 20 });
  assert.equal(body.track_total_hits, true);
  assert.equal(body.from, 0);
  assert.equal(body.size, 20);
  assert.equal(body.query.bool.must.multi_match.query, "chips");
  assert.equal(body.query.bool.must.multi_match.type, "best_fields");
  assert.equal(body.query.bool.must.multi_match.fuzziness, "AUTO");
  assert.deepEqual(body.query.bool.must.multi_match.fields, ["name^3", "description"]);
  assert.deepEqual(body.query.bool.filter, []);
});

test("match_all body when q missing or blank", () => {
  for (const q of [undefined, "", "   "]) {
    const body = buildSearchBody({ q });
    assert.deepEqual(body.query.bool.must, { match_all: {} });
  }
});

test("filters stack as exact terms", () => {
  const body = buildSearchBody({
    category: "Snacks",
    subcategory: "Crackers",
    availability: "in_stock",
    organic: "true",
    minPrice: 1,
    maxPrice: 10,
  });
  assert.deepEqual(body.query.bool.filter, [
    { term: { category: "Snacks" } },
    { term: { subcategory: "Crackers" } },
    { term: { availability: "in_stock" } },
    { term: { organic: true } },
    { range: { price: { gte: 1 } } },
    { range: { price: { lte: 10 } } },
  ]);
});

test("sort mapping: price/name directions and relevance default", () => {
  const price = buildSearchBody({ sort: "price", order: "asc" });
  assert.deepEqual(price.sort, [
    { price: { order: "asc", missing: "_last", unmapped_type: "double" } },
  ]);
  const name = buildSearchBody({ sort: "name", order: "asc" });
  assert.deepEqual(name.sort[0]["name.keyword"].order, "asc");
  const relevance = buildSearchBody({ sort: "bogus", order: "whatever" });
  assert.deepEqual(relevance.sort, [{ _score: { order: "desc" } }]);
});

test("from/size wiring for pagination", () => {
  const body = buildSearchBody({ page: undefined, from: 40, size: 20 });
  assert.equal(body.from, 40);
  assert.equal(body.size, 20);
});

test("translateHits handles numeric total and {value} total", () => {
  const numeric = translateHits(
    { from: 0, size: 2 },
    {
      hits: {
        total: 42,
        hits: [{ _source: { name: "A", price: 1, images: [] }, _score: 1.234567 }],
      },
    },
  );
  assert.equal(numeric.total, 42);
  assert.equal(numeric.page.from, 0);
  assert.equal(numeric.hits[0].name, "A");
  assert.equal(numeric.hits[0].price, 1);
  assert.equal(numeric.hits[0].images.length, 0);
  assert.equal(numeric.hits[0].score, 1.2346);

  const object = translateHits(
    { from: 20, size: 10 },
    { hits: { total: { value: 5047 }, hits: [] } },
  );
  assert.equal(object.total, 5047);
  assert.equal(object.page.from, 20);
  assert.deepEqual(object.hits, []);
});

test("translateHits only exposes the allowed display fields", () => {
  const result = translateHits(
    { from: 0, size: 1 },
    {
      hits: {
        total: 1,
        hits: [
          {
            _source: {
              sku: "UPC-1",
              name: "Field Greens",
              price: 4.99,
              category: "Produce",
              descriptionSource: "homesome",
              internalField: "should-never-leak",
            },
            _score: 0.5,
          },
        ],
      },
    },
  );
  assert.equal(result.hits[0].sku, "UPC-1");
  assert.equal(result.hits[0].name, "Field Greens");
  assert.equal("internalField" in result.hits[0], false);
});