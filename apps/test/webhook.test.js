import test from "node:test";
import assert from "node:assert/strict";

import { parseSkus } from "../src/routes/webhook.js";

test("parseSkus resolves sku + quantity pairs from session metadata", () => {
  const skus = parseSkus({ skus: "X1,X2", quantities: "2,1" });
  assert.deepEqual(skus, [
    { sku: "X1", quantity: 2 },
    { sku: "X2", quantity: 1 },
  ]);
});

test("parseSkus falls back to quantity 1 / empty list", () => {
  assert.deepEqual(parseSkus({ skus: "X1,", quantities: "3," }), [{ sku: "X1", quantity: 3 }]);
  assert.deepEqual(parseSkus(undefined), []);
});