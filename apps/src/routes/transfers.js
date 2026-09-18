/**
 * Fund flows (Stage 4).
 *
 *   GET   /api/orders/:sessionId   — order record + authoritative Stripe
 *                                    PaymentIntent, computed revenue split and
 *                                    platform/merchant balances
 *   POST  /api/orders/:sessionId/split   — compute the platform/merchant split
 *                                          (also applied by the webhook)
 *   POST  /api/orders/:sessionId/transfer — SEPARATE CHARGES AND TRANSFERS:
 *                                          after the charge lands on the
 *                                          platform, push the merchant's share to
 *                                          their connected account as a Transfer.
 *
 * Money movement (separate charges & transfers):
 *   1. platform charges the customer (platform balance +full amount)
 *   2. platform keeps its fee (platform balance net)
 *   3. a Transfer later moves the merchant share platform -> merchant account
 */

import { Router } from "express";
import { query } from "../db.js";
import { HttpError, asyncHandler } from "../util.js";
import {
  assertStripeConfigured,
  calculatePlatformFee,
  createTransfer,
  getStripe,
  stripeConfigured,
} from "../stripe.js";

export const transfersRouter = Router();

const ORDER_FIELDS =
  "id, stripe_session_id, stripe_payment_intent_id, merchant_id, amount_total, currency, status, created_at";

async function findOrderBySession(sessionId) {
  const result = await query(
    `SELECT ${ORDER_FIELDS} FROM orders WHERE stripe_session_id = $1`,
    [sessionId],
  );
  if (!result.rows[0]) {
    throw new HttpError(404, `No recorded order for session ${sessionId}`, "order_not_found");
  }
  return result.rows[0];
}

transfersRouter.get(
  "/:sessionId",
  asyncHandler(async (req, res) => {
    const order = await findOrderBySession(req.params.sessionId);
    const amountMinor = Math.round(Number(order.amount_total) * 100);
    const split = calculatePlatformFee(amountMinor);

    let paymentIntent = null;
    let transfer = null;
    let balances = { platform: null, merchant: null };

    if (stripeConfigured) {
      // 1) The authoritative Stripe PaymentIntent for this session (amount,
      //    status, application fee). Demonstrates what the customer was
      //    actually charged vs. what we computed server-side.
      if (order.stripe_payment_intent_id) {
        try {
          const pi = await getStripe().paymentIntents.retrieve(
            order.stripe_payment_intent_id,
          );
          paymentIntent = {
            id: pi.id,
            status: pi.status,
            amount: pi.amount,
            currency: pi.currency,
            applicationFeeAmount: pi.application_fee_amount,
            onBehalfOf: pi.on_behalf_of || null,
            transferData: pi.transfer_data || null,
          };
        } catch (err) {
          console.warn("[orders] payment intent not retrievable:", err.message);
        }
      }

      // 2) A Transfer under this session's group = fund flow #2 already ran.
      try {
        const transfers = await getStripe().transfers.list({
          transfer_group: order.stripe_session_id,
          limit: 5,
        });
        if (transfers.data.length > 0) {
          const t = transfers.data[0];
          transfer = { id: t.id, amount: t.amount, destination: t.destination };
        }
      } catch (err) {
        console.warn("[orders] transfer list not retrievable:", err.message);
      }

      // 3) Live balances: platform balance vs. connected-account balance show
      //    where the money actually land after capture.
      const merchant = await query(
        "SELECT stripe_account_id FROM merchants WHERE id = $1",
        [order.merchant_id],
      );
      const merchantAccount = merchant.rows[0]?.stripe_account_id || null;
      try {
        const [platform, connected] = await Promise.all([
          getStripe().balance.retrieve(),
          merchantAccount
            ? getStripe().balance.retrieve({ stripeAccount: merchantAccount })
            : Promise.resolve(null),
        ]);
        balances.platform = (platform.available[0] || {}).amount ?? null;
        balances.merchant = (connected?.available[0] || {}).amount ?? null;
      } catch (err) {
        console.warn("[orders] balance retrieval failed:", err.message);
      }
    }

    res.json({
      order: { ...order, id: Number(order.id), merchantId: order.merchant_id ? Number(order.merchant_id) : null },
      amountMinor,
      split,
      paymentIntent,
      transfer,
      balances,
    });
  }),
);

transfersRouter.post(
  "/:sessionId/split",
  asyncHandler(async (req, res) => {
    const order = await findOrderBySession(req.params.sessionId);
    const amountMinor = Math.round(Number(order.amount_total) * 100);
    const split = calculatePlatformFee(amountMinor);
    res.json({ order, split });
  }),
);

transfersRouter.post(
  "/:sessionId/transfer",
  asyncHandler(async (req, res) => {
    assertStripeConfigured();
    const order = await findOrderBySession(req.params.sessionId);

    const merchant = await query(
      "SELECT id, stripe_account_id, status FROM merchants WHERE id = $1",
      [order.merchant_id],
    );
    if (!merchant.rows[0]) {
      throw new HttpError(409, "Order has no merchant linked", "no_merchant");
    }
    const { stripe_account_id: accountId, status: merchantStatus } = merchant.rows[0];
    if (!accountId) {
      throw new HttpError(409, "Merchant has no Stripe account (set STRIPE_SECRET_KEY and re-onboard)", "no_stripe_account");
    }
    if (merchantStatus !== "verified") {
      throw new HttpError(
        409,
        `Payout prevented: merchant status is '${merchantStatus}' — only verified merchants can receive transfers`,
        "merchant_not_verified",
      );
    }
    if (/^acct_sim_/.test(accountId)) {
      throw new HttpError(
        409,
        "Merchant uses a simulated Stripe account (acct_sim_*), which cannot receive real payouts. Create a real connected account for destination charges/transfers.",
        "simulated_stripe_account",
      );
    }

    const amountMinor = Math.round(Number(order.amount_total) * 100);
    const { merchantShare } = calculatePlatformFee(amountMinor);

    // Idempotency key = "transfer:{sessionId}:{merchantId}" so a retry never
    // double-pays the merchant.
    const key = `transfer:${order.stripe_session_id}:${order.merchant_id}`;
    const transfer = await createTransfer({
      stripeAccountId: accountId,
      amountMinor: merchantShare,
      currency: (order.currency || "CAD").toLowerCase(),
      transferGroup: order.stripe_session_id,
      idempotencyKey: key,
    });

    console.log(
      `[transfer] ${order.stripe_session_id}: ${merchantShare / 100} ${order.currency} -> merchant $${merchant.rows[0].id} (transfer ${transfer.id})`,
    );

    res.json({
      transferId: transfer.id,
      amount: merchantShare,
      currency: order.currency,
      transferGroup: order.stripe_session_id,
      platformShare: amountMinor - merchantShare,
      merchantStatus: merchantStatus,
    });
  }),
);