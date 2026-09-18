/**
 * POST /api/stripe/webhook — Stripe events.
 *
 * The raw body is required so the `stripe-signature` header can be verified
 * against STRIPE_WEBHOOK_SECRET. Events arrive at-least-once, so handlers must
 * be idempotent (INSERT ... ON CONFLICT skips duplicates).
 *
 * Currently handled events:
 *   checkout.session.completed  -> order recorded in PostgreSQL with the
 *                                  platform/merchant revenue split applied.
 */

import { Router, raw } from "express";
import { HttpError } from "../util.js";
import { query } from "../db.js";
import { calculatePlatformFee, getStripe } from "../stripe.js";

export const webhookRouter = Router();

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

function notConfigured() {
  return new HttpError(
    503,
    "Stripe webhooks are not configured: set STRIPE_WEBHOOK_SECRET",
    "stripe_not_configured",
  );
}

export function parseSkus(metadata) {
  const skus = (metadata?.skus || "").split(",").filter(Boolean);
  const quantities = (metadata?.quantities || "").split(",").map(Number);
  return skus.map((sku, i) => ({ sku, quantity: quantities[i] || 1 }));
}

/**
 * Persist a completed checkout as an order. Idempotent per stripe session id
 * (unique constraint + ON CONFLICT DO NOTHING). The revenue split is computed
 * here on the authoritative Stripe amount — the platform fee is never taken
 * from a client-supplied number.
 */
export async function recordCompletedOrder(session) {
  const skus = parseSkus(session.metadata || {});
  const amountTotal = Number(session.amount_total) / 100;
  const split = calculatePlatformFee(Number(session.amount_total));

  const merchant = await query(
    "SELECT id FROM merchants WHERE stripe_account_id = $1",
    [session.metadata?.merchant_account || null],
  );
  const merchantId = merchant.rows[0]?.id ?? null;

  const result = await query(
    `INSERT INTO orders
      (stripe_session_id, stripe_payment_intent_id, merchant_id,
       amount_total, amount_platform, amount_merchant, currency, status, skus)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'paid', $8::jsonb)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING id`,
    [
      session.id,
      typeof session.payment_intent === "string" ? session.payment_intent : null,
      merchantId,
      amountTotal.toFixed(2),
      (split.platformFee / 100).toFixed(2),
      (split.merchantShare / 100).toFixed(2),
      (session.currency || "cad").toUpperCase(),
      JSON.stringify(skus),
    ],
  );

  console.log(
    `[webhook] order persisted for session ${session.id}: id=${result.rows[0]?.id ?? "(already recorded)"} amount=${amountTotal}`,
  );

  return result.rows[0]?.id ?? null;
}

webhookRouter.post(
  "/",
  raw({ type: "application/json" }),
  async (req, res, next) => {
    try {
      if (!webhookSecret) throw notConfigured();

      const signature = req.headers["stripe-signature"];
      if (!signature || typeof signature !== "string") {
        throw new HttpError(400, "Missing stripe-signature header", "invalid_signature");
      }

      const stripe = getStripe();
      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
      } catch (err) {
        throw new HttpError(
          400,
          `Webhook signature verification failed: ${err.message}`,
          "invalid_signature",
        );
      }

      switch (event.type) {
        case "checkout.session.completed":
          await recordCompletedOrder(event.data.object);
          break;
        case "checkout.session.expired":
        case "payment_intent.payment_failed":
          console.log(`[webhook] ${event.type} — no order recorded`);
          break;
        default:
          console.log(`[webhook] unhandled event type: ${event.type}`);
      }

      res.json({ received: true, type: event.type });
    } catch (err) {
      next(err);
    }
  },
);