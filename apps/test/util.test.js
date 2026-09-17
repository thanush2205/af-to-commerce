import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpError,
  clamp,
  parsePagination,
  totalPages,
  paginationMeta,
  optionalString,
  optionalNumber,
} from "../src/util.js";

test("parsePagination defaults and clamping", () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 20, offset: 0 });
  assert.deepEqual(parsePagination({ page: 2, limit: 50 }, { limit: 25 }), {
    page: 2,
    limit: 50,
    offset: 50,
  });
  assert.deepEqual(parsePagination({ page: 0, limit: 0 }), {
    page: 1,
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(parsePagination({ page: -3, limit: 999 }), {
    page: 1,
    limit: 100,
    offset: 0,
  });
  assert.deepEqual(parsePagination({ page: "abc", limit: "xyz" }), {
    page: 1,
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(parsePagination({ page: 3.9, limit: 10.9 }), {
    page: 3,
    limit: 10,
    offset: 20,
  });
});

test("paginationMeta and totalPages", () => {
  assert.equal(totalPages(0, 20), 1);
  assert.equal(totalPages(20, 20), 1);
  assert.equal(totalPages(21, 20), 2);
  assert.equal(totalPages(5047, 50), 101);
  assert.deepEqual(paginationMeta(5047, 3, 50), {
    total: 5047,
    page: 3,
    limit: 50,
    pages: 101,
  });
});

test("optionalString trims and normalizes blanks", () => {
  assert.equal(optionalString(" chips "), "chips");
  assert.equal(optionalString(""), undefined);
  assert.equal(optionalString("   "), undefined);
  assert.equal(optionalString(undefined), undefined);
});

test("optionalNumber rejects junk", () => {
  assert.equal(optionalNumber("3.49"), 3.49);
  assert.equal(optionalNumber(""), undefined);
  assert.equal(optionalNumber("not-a-number"), undefined);
  assert.equal(optionalNumber(0), 0);
  assert.equal(optionalNumber("12"), 12);
});

test("HttpError carries status/code and clamp bounds", () => {
  const err = new HttpError(404, "nope", "product_not_found");
  assert.equal(err.status, 404);
  assert.equal(err.code, "product_not_found");
  assert.equal(clamp(50, 1, 100), 50);
  assert.equal(clamp(-5, 1, 100), 1);
  assert.equal(clamp(500, 1, 100), 100);
});