import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePlatformFee,
  platformFeeRateFor,
} from "../src/stripe.js";

test("revenue share: $40 (< $50) -> 20% platform / 80% merchant", () => {
  const split = calculatePlatformFee(4000);
  assert.equal(split.rate, 0.2);
  assert.equal(split.platformFee, 800);
  assert.equal(split.merchantShare, 3200);
});

test("revenue share: $75 ($50-$100) -> 15% / 85%", () => {
  const split = calculatePlatformFee(7500);
  assert.equal(split.rate, 0.15);
  assert.equal(split.platformFee, 1125);
  assert.equal(split.merchantShare, 6375);
});

test("revenue share: $150 (> $100) -> 10% / 90%", () => {
  const split = calculatePlatformFee(15000);
  assert.equal(split.rate, 0.1);
  assert.equal(split.platformFee, 1500);
  assert.equal(split.merchantShare, 13500);
});

test("revenue share: exact boundaries are programmatic, not hardcoded", () => {
  assert.equal(platformFeeRateFor(5000), 0.15); // exactly $50 -> 15% tier
  assert.equal(platformFeeRateFor(10000), 0.15); // exactly $100 -> 15% tier
  assert.equal(platformFeeRateFor(10001), 0.1); // $100.01 -> 10% tier
  assert.equal(platformFeeRateFor(4999), 0.2);
  assert.equal(platformFeeRateFor(0), 0.2);
});

test("revenue share: platform fee can never exceed the order total", () => {
  for (const amount of [1, 99, 1234, 56789, 999999]) {
    const split = calculatePlatformFee(amount);
    assert.ok(split.platformFee <= split.total);
    assert.equal(split.platformFee + split.merchantShare, split.total);
  }
});