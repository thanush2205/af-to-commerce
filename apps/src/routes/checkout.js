/**
 * POST /api/checkout — create a Stripe Checkout Session.
 *   Body: { items: [{ sku, quantity }], successUrl?, cancelUrl? }
 *
 * Prices are NOT read from the request. The body only carries sku + quantity;
 * the authoritative price/availability come from PostgreSQL, then line items
 * are built server-side. The frontend amount is never trusted.
 *
 * When the cart maps to a single VERIFIED merchant, the session uses a
 * DESTINATION CHARGE: the payment intent is created on the connected account,
 * the platform fee is taken as application_fee_amount, and the merchant share
 * settles directly into the merchant's balance (fund flow #1).
 *
 * Any other cart runs a PLATFORM CHARGE. The merchant is still recorded in the
 * session metadata when the cart belongs to one merchant, so the merchant
 * share can be moved later via POST /api/orders/:sessionId/transfer (fund
 * flow #2 — separate charges and transfers).
 *
 * GET /api/checkout/session/:id — retrieve a session by id (used by the
 * order confirmation page to show authoritative status + totals).
 */

import { Router } from "express";
import { query } from "../db.js";
import { HttpError, asyncHandler } from "../util.js";
import {
  assertStripeConfigured,
  getStripe,
  parseCheckoutBody,
  buildLineItems,
  computeTotalMinor,
  calculatePlatformFee,
  destinationChargeSessionArgs,
} from "../stripe.js";

export const checkoutRouter = Router();

const CHECKOUT_FIELDS = `
  p.sku, p.name, p.price, p.currency, p.availability, p.is_active,
  p.merchant_id, m.status AS merchant_status, m.stripe_account_id AS merchant_account`;

function returnUrl(req, key, fallbackPath) {
  const raw = req.body?.[key] || fallbackPath;
  const base = process.env.WEBAPP_URL || "http://localhost:3001";
  const url = new URL(raw, base);
  return url.href;
}

/**
 * Identify the single merchant that owns the whole cart (if any), regardless
 * of verification state. Records merchant identity on the session so the
 * merchant share can be paid out later via a Transfer.
 */
export function resolveSingleMerchant(rows) {
  const merchants = new Set(rows.map((r) => r.merchant_id).filter(Boolean));
  if (merchants.size !== 1) return null;
  const merchantId = merchants.values().next().value;
  const row = rows.find((r) => r.merchant_id === merchantId);
  if (!row || !row.merchant_account) return null;
  return { merchantId, merchantAccount: row.merchant_account };
}

/**
 * Determine whether this cart is eligible for a destination charge.
 * Requires exactly one VERIFIED merchant linked to a REAL Stripe connected
 * account (a real account id looks like `acct_1...`, while this repo's demo
 * seeds use simulated `acct_sim_*` ids that only work with the demo Stripe
 * key). Otherwise the payment runs entirely on the platform (still fine —
 * the merchant share is moved by Transfer at settlement).
 */
export function resolveMerchantSession(rows) {
  const single = resolveSingleMerchant(rows);
  if (!single) return null;
  const row = rows.find((r) => r.merchant_id === single.merchantId);
  if (!row || row.merchant_status !== "verified") return null;
  if (!/^acct_[0-9A-Za-z]+$/.test(row.merchant_account || "")) return null;
  return single;
}

checkoutRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    assertStripeConfigured();

    const { items, skus } = parseCheckoutBody(req.body);

    const result = await query(
      `SELECT ${CHECKOUT_FIELDS}
         FROM products p
         LEFT JOIN merchants m ON m.id = p.merchant_id
        WHERE p.sku = ANY($1)`,
      [skus],
    );
    if (result.rows.length !== skus.length) {
      throw new HttpError(409, "Some cart items do not exist", "products_changed");
    }

    const quantitiesBySku = new Map(items.map((i) => [i.sku, i.quantity]));
    const lineItems = buildLineItems(result.rows, quantitiesBySku);
    const totalMinor = computeTotalMinor(result.rows, quantitiesBySku);
    const { platformFee } = calculatePlatformFee(totalMinor);

    const merchant = resolveMerchantSession(result.rows);
    const merchantOwner = resolveSingleMerchant(result.rows);

    const successUrl = returnUrl(req, "successUrl", "/checkout/success");
    const cancelUrl = returnUrl(req, "cancelUrl", "/checkout/cancel");

    const stripe = getStripe();

    // DESTINATION CHARGE when a verified merchant owns the whole cart;
    // otherwise a plain platform charge (the merchant share is then paid via
    // POST /api/orders/:sessionId/transfer once a merchant is linked).
    let sessionData = {};
    const sessionMetadata = {
      skus: skus.join(","),
      quantities: items.map((i) => i.quantity).join(","),
      source: "af-to-commerce",
    };

    if (merchantOwner) {
      // Always record the merchant identity so fund flow #2 (separate charges
      // and transfers) can settle the merchant share for platform charges too.
      sessionMetadata.merchant_account = merchantOwner.merchantAccount;
      sessionMetadata.merchant_id = String(merchantOwner.merchantId);
    }

    if (merchant) {
      sessionData = destinationChargeSessionArgs({
        stripeAccountId: merchant.merchantAccount,
        platformFee,
      });
      sessionMetadata.flow = "destination_charge";
    } else {
      sessionMetadata.flow = "platform_charge";
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      client_reference_id: skus.join(","),
      metadata: sessionMetadata,
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      ...sessionData,
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      amountTotal: totalMinor,
      currency: result.rows[0]?.currency || "CAD",
      platformFee,
      flow: merchant ? "destination_charge" : "platform_charge",
      merchantAccount: merchant?.merchantAccount ?? null,
    });
  }),
);

checkoutRouter.get(
  "/session/:id",
  asyncHandler(async (req, res) => {
    assertStripeConfigured();

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(req.params.id);

    let lineItems = [];
    try {
      const li = await stripe.checkout.sessions.listLineItems(req.params.id, {
        limit: 100,
      });
      lineItems = li.data.map((item) => ({
        name: item.description,
        quantity: item.quantity,
        amountTotal: item.amount_total,
      }));
    } catch {
      /* some sessions expose no line items — still fine */
    }

    res.json({
      id: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      amountTotal: session.amount_total,
      currency: session.currency,
      customerEmail: session.customer_details?.email || null,
      metadata: session.metadata || {},
      lineItems,
    });
  }),
);