import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCheckoutBody,
  buildLineItems,
  computeTotalMinor,
  toMinorUnit,
  calculatePlatformFee,
} from "../src/stripe.js";
import { resolveMerchantSession, resolveSingleMerchant } from "../src/routes/checkout.js";

const MERCHANT_ROW = {
  sku: "X1",
  name: "Apple",
  price: "4.99",
  currency: "CAD",
  availability: "in_stock",
  is_active: true,
  merchant_id: 1,
  merchant_status: "verified",
  merchant_account: "acct_merchant1",
};

test("toMinorUnit converts decimal prices to cents", () => {
  assert.equal(toMinorUnit(4.99), 499);
  assert.equal(toMinorUnit("12.00"), 1200);
  assert.equal(toMinorUnit(0), 0);
});

test("parseCheckoutBody normalizes valid items", () => {
  const { items, skus } = parseCheckoutBody({
    items: [
      { sku: "A1", quantity: 2 },
      { sku: " B2 ", quantity: "1" },
    ],
  });
  assert.deepEqual(skus, ["A1", "B2"]);
  assert.deepEqual(items, [
    { sku: "A1", quantity: 2 },
    { sku: "B2", quantity: 1 },
  ]);
});

test("parseCheckoutBody rejects empty / bad carts", () => {
  assert.throws(() => parseCheckoutBody({}), /at least one item/);
  assert.throws(() => parseCheckoutBody({ items: [{ sku: "", quantity: 1 }] }), /missing an sku/);
  assert.throws(() => parseCheckoutBody({ items: [{ sku: "A", quantity: 0 }] }), /invalid quantity/);
  assert.throws(() => parseCheckoutBody({ items: [{ sku: "A", quantity: 1.5 }] }), /invalid quantity/);
  assert.throws(() => parseCheckoutBody({ items: [{ sku: "A", quantity: 1 }, { sku: "A", quantity: 1 }] }), /Duplicate sku/);
});

test("buildLineItems computes server-side prices, not client amounts", () => {
  const rows = [
    { sku: "X1", name: "Apple", price: "4.99", currency: "CAD", availability: "in_stock", is_active: true },
    { sku: "X2", name: "Milk", price: "3.50", currency: "CAD", availability: "in_stock", is_active: true },
  ];
  const quantities = new Map([["X1", 2], ["X2", 1]]);

  const items = buildLineItems(rows, quantities);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].price_data.unit_amount, 499);
  assert.equal(items[0].price_data.currency, "cad");
  assert.equal(items[0].price_data.product_data.name, "Apple");
  assert.equal(items[1].price_data.unit_amount, 350);
});

test("buildLineItems rejects unavailable products", () => {
  const rows = [
    { sku: "X1", name: "Sold out", price: "1", currency: "CAD", availability: "out_of_stock", is_active: true },
  ];
  assert.throws(
    () => buildLineItems(rows, new Map([["X1", 1]])),
    /not in stock/,
  );
});

test("buildLineItems rejects cart/product count mismatch", () => {
  const rows = [{ sku: "X1", name: "A", price: "1", currency: "CAD", availability: "in_stock", is_active: true }];
  assert.throws(
    () => buildLineItems(rows, new Map([["X1", 1], ["X9", 1]])),
    /Some cart items no longer exist|no longer available/,
  );
});

test("computeTotalMinor sums quantity * unit_price", () => {
  const rows = [
    { sku: "X1", price: "4.99" },
    { sku: "X2", price: "3.50" },
  ];
  const quantities = new Map([["X1", 2], ["X2", 1]]);
  assert.equal(computeTotalMinor(rows, quantities), 499 * 2 + 350);
});

test("resolveMerchantSession requires exactly one verified merchant", () => {
  const single = resolveMerchantSession([MERCHANT_ROW]);
  assert.deepEqual(single, { merchantId: 1, merchantAccount: "acct_merchant1" });

  assert.equal(resolveMerchantSession([]), null);
  assert.equal(
    resolveMerchantSession([
      { ...MERCHANT_ROW, merchant_id: 1 },
      { ...MERCHANT_ROW, sku: "X2", merchant_id: 2 },
    ]),
    null,
    "two merchants -> no destination charge",
  );
  assert.equal(
    resolveMerchantSession([{ ...MERCHANT_ROW, merchant_status: "restricted" }]),
    null,
    "unverified merchant blocks destination charge",
  );
  assert.equal(
    resolveMerchantSession([{ ...MERCHANT_ROW, merchant_account: null }]),
    null,
    "no connected account blocks destination charge",
  );
  assert.equal(
    resolveMerchantSession([{ ...MERCHANT_ROW, merchant_account: "acct_sim_maple-acres" }]),
    null,
    "simulated acct_sim_* account blocks destination charge against the real Stripe API",
  );
});

test("resolveSingleMerchant tags one merchant even when unverified (separate charges & transfers)", () => {
  const restricted = { ...MERCHANT_ROW, merchant_status: "restricted" };
  assert.deepEqual(resolveSingleMerchant([restricted]), {
    merchantId: 1,
    merchantAccount: "acct_merchant1",
  });
  // Multi-merchant carts and unassigned products stay untagged.
  assert.equal(
    resolveSingleMerchant([
      { ...MERCHANT_ROW, merchant_id: 1 },
      { ...MERCHANT_ROW, sku: "X2", merchant_id: 2 },
    ]),
    null,
  );
  assert.equal(resolveSingleMerchant([{ ...MERCHANT_ROW, merchant_id: null }]), null);
});

test("platform fee is applied to the destination charge", () => {
  const split = calculatePlatformFee(computeTotalMinor([MERCHANT_ROW], new Map([["X1", 1]])));
  assert.equal(split.platformFee, Math.round(499 * 0.2));
});