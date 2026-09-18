/**
 * Stripe client + checkout / Stripe Connect helpers.
 *
 * The backend NEVER trusts prices submitted by the frontend. The storefront
 * sends only (sku, quantity) pairs; authoritative prices are re-fetched from
 * PostgreSQL here and turned into Stripe line items.
 *
 * Revenue share is calculated programmatically (see calculatePlatformFee) and
 * never hardcoded into an individual payment flow.
 */

import Stripe from "stripe";
import { HttpError } from "./util.js";

export const STRIPE_API_VERSION = "2024-06-20";

/** Lazy client so tests and unconfigured dev boxes don't force a key. */
let _stripe = null;

export function getStripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
    apiVersion: STRIPE_API_VERSION,
  });
  return _stripe;
}

/** True when a test key is configured (not the placeholder). */
export const stripeConfigured =
  Boolean(process.env.STRIPE_SECRET_KEY) &&
  !process.env.STRIPE_SECRET_KEY.startsWith("sk_test_xxx");

export function assertStripeConfigured() {
  if (!stripeConfigured) {
    throw new HttpError(
      503,
      "Stripe is not configured: set STRIPE_SECRET_KEY (test mode)",
      "stripe_not_configured",
    );
  }
}

/** Convert a decimal product price to the Stripe minor unit (cents). */
export function toMinorUnit(price) {
  const minor = Math.round(Number(price) * 100);
  if (!Number.isFinite(minor) || minor < 0) {
    throw new HttpError(500, "Invalid product price", "invalid_price");
  }
  return minor;
}

/* ---------------------------------------------------------------------------
 * Revenue share (Stage 4)
 * ------------------------------------------------------------------------- */

/**
 * Revenue-share tiers (order amount in MINOR units -> platform cut).
 *   > $100   -> 10%
 *   $50-$100 -> 15%
 *   < $50    -> 20%
 *
 * Tiers are matched first-wins, descending by `minMinor`, and cover the exact
 * boundaries: amounts from $50.00 up to $100.00 inclusive are the 15% tier.
 *
 * PROGRAMMATIC: the calculation lives in one reusable function (unit tested)
 * and is applied to the server-side total — never to a client-supplied amount.
 */
export const PLATFORM_FEE_TIERS = [
  { minMinor: 10_001, rate: 0.10 }, // >   $100.00
  { minMinor: 5_000, rate: 0.15 }, //      $50.00 - $100.00 inclusive
  { minMinor: 0, rate: 0.20 }, //  <  $50.00
];

export function platformFeeRateFor(amountMinor) {
  const amount = Number(amountMinor);
  for (const tier of PLATFORM_FEE_TIERS) {
    if (amount >= tier.minMinor) return tier.rate;
  }
  return PLATFORM_FEE_TIERS[PLATFORM_FEE_TIERS.length - 1].rate;
}

/**
 * Split an order total (already in MINOR units / cents) into platform fee +
 * merchant share. Returns exact integers so no rounding is left to the payment
 * flow. Does NOT interpret dollars, so callers pass computeTotalMinor() output.
 */
export function calculatePlatformFee(amountMinor) {
  const amount = Number(amountMinor);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new HttpError(500, "Invalid amount for revenue split", "invalid_amount");
  }
  const rate = platformFeeRateFor(amount);
  const platformFee = Math.round(amount * rate);
  return {
    total: amount,
    rate,
    platformFee,
    merchantShare: amount - platformFee,
  };
}

/* ---------------------------------------------------------------------------
 * Account helpers
 * ------------------------------------------------------------------------- */

/** Stripe Connect custom account default capabilities for this demo. */
export const CONNECT_CAPABILITIES = {
  transfers: { requested: true },
  card_payments: { requested: true },
};

/**
 * Create a Custom Connected Account on the platform. Custom accounts are fully
 * API-controlled — the merchant never creates the account themselves.
 * https://stripe.com/docs/connect/custom-accounts
 */
export async function createConnectedAccount({ name, email }) {
  assertStripeConfigured();
  const account = await getStripe().accounts.create({
    type: "custom",
    country: "CA",
    email,
    business_type: "company",
    business_profile: { name, url: `https://summerhill.demo/${encodeURIComponent(name)}` },
    company: {
      name,
      // Minimal test values; fill the rest via the account-update / onboarding
      // link documented in README so payouts can be enabled.
      tax_id: null,
    },
    capabilities: CONNECT_CAPABILITIES,
    settings: {
      payouts: { schedule: { interval: "manual" } },
    },
    metadata: { source: "af-to-commerce", merchant_name: name },
  });
  return account;
}

/**
 * Derive our canonical 'verified' / 'failed' / 'restricted' status from a
 * Stripe Custom Connected Account object. This is the single source of truth
 * for the merchant-status screen.
 */
export function readableAccountStatus(account) {
  const req = account.requirements || {};
  if (req.disabled_reason) {
    return req.disabled_reason === "requirements.past_due" ? "restricted" : "failed";
  }
  if (!account.charges_enabled || !account.payouts_enabled) return "restricted";
  return "verified";
}

export function assertVerifiedAccount(status) {
  if (status !== "verified") {
    throw new HttpError(
      409,
      `Merchant is not payable in this state (${status}); payouts are prevented`,
      "merchant_not_verified",
    );
  }
}

/* ---------------------------------------------------------------------------
 * Fund flows (Stage 4)
 * ------------------------------------------------------------------------- */

/**
 * 1) DESTINATION CHARGE via Checkout Session.
 * The payment intent is created on the connected account at capture time; the
 * platform takes application_fee_amount immediately, the rest lands in the
 * connected account's balance. No separate transfer is needed.
 */
export function destinationChargeSessionArgs({ stripeAccountId, platformFee }) {
  return {
    payment_intent_data: {
      transfer_data: { destination: stripeAccountId },
      application_fee_amount: platformFee,
    },
  };
}

/**
 * 2) SEPARATE CHARGES AND TRANSFERS — post-pay transfer from platform balance
 * to the connected account. The charge runs on the PLATFORM account, later a
 * Transfer moves the merchant's share. This gives the platform control over
 * timing (useful for escrow / settlement batching).
 */
export async function createTransfer({ stripeAccountId, amountMinor, currency, transferGroup, idempotencyKey }) {
  assertStripeConfigured();
  return getStripe().transfers.create(
    {
      amount: amountMinor,
      currency,
      destination: stripeAccountId,
      transfer_group: transferGroup,
      metadata: { source: "af-to-commerce" },
    },
    { idempotencyKey },
  );
}

/* ---------------------------------------------------------------------------
 * Checkout session helpers
 * ------------------------------------------------------------------------- */

/**
 * Normalize + validate a raw checkout request body.
 * Returns { items: [{ sku, quantity }], skus } or throws a 400 HttpError.
 */
export function parseCheckoutBody(body = {}) {
  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length === 0) {
    throw new HttpError(400, "Checkout requires at least one item", "invalid_cart");
  }

  const items = [];
  const seen = new Map();

  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
    const quantity = Number(item?.quantity);

    if (!sku) {
      throw new HttpError(400, `Item ${i} is missing an sku`, "invalid_cart");
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new HttpError(
        400,
        `Item ${i} (${sku}) has an invalid quantity`,
        "invalid_cart",
      );
    }
    if (seen.has(sku)) {
      throw new HttpError(400, `Duplicate sku in cart: ${sku}`, "invalid_cart");
    }
    seen.set(sku, quantity);
    items.push({ sku, quantity });
  }

  return { items, skus: items.map((i) => i.sku) };
}

/**
 * Build Stripe line_items for a Checkout Session from authoritative
 * PostgreSQL product rows. Throws 409 for unavailable products.
 */
export function buildLineItems(rows, quantitiesBySku) {
  if (rows.length !== quantitiesBySku.size) {
    throw new HttpError(
      409,
      "Some cart items no longer exist",
      "products_changed",
    );
  }

  const lineItems = [];
  for (const row of rows) {
    const quantity = quantitiesBySku.get(row.sku);
    if (quantity === undefined) {
      throw new HttpError(
        409,
        `Product ${row.sku} is no longer available`,
        "products_changed",
      );
    }
    if (row.availability !== "in_stock" || !row.is_active) {
      throw new HttpError(
        409,
        `Product "${row.name}" is not in stock`,
        "product_unavailable",
      );
    }
    lineItems.push({
      quantity,
      price_data: {
        currency: (row.currency || "CAD").toLowerCase(),
        unit_amount: toMinorUnit(row.price),
        product_data: {
          name: row.name,
          metadata: { sku: row.sku },
        },
      },
    });
  }
  return lineItems;
}

/** Server-side authoritative total in minor units. */
export function computeTotalMinor(rows, quantitiesBySku) {
  return rows.reduce(
    (acc, row) => acc + toMinorUnit(row.price) * (quantitiesBySku.get(row.sku) || 0),
    0,
  );
}