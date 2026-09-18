/**
 * Stripe Connect merchant management (Stage 4).
 *
 *   GET  /api/merchants                — list merchants with account status
 *   POST /api/merchants                — create + onboard a Custom Connected
 *                                        Account (API-controlled onboarding)
 *   GET  /api/merchants/:id            — merchant detail + status
 *   PATCH /api/merchants/:id/status    — SIMULATE verified | failed | restricted
 *
 * Custom merchants are never exposed directly to end users; only a status
 * surface / admin reads these.
 */

import { Router } from "express";
import { query } from "../db.js";
import { HttpError, asyncHandler, optionalString } from "../util.js";
import {
  createConnectedAccount,
  getStripe,
  readableAccountStatus,
  stripeConfigured,
} from "../stripe.js";

export const merchantsRouter = Router();

const MERCHANT_FIELDS = `
  id, name, email, stripe_account_id, status, status_reason,
  capabilities, payout_schedule, created_at, updated_at`;

function shapeMerchant(row, { connectedStatus } = {}) {
  return {
    id: Number(row.id),
    name: row.name,
    email: row.email,
    stripeAccountId: row.stripe_account_id,
    status: connectedStatus || row.status,
    storedStatus: row.status,
    statusReason: row.status_reason,
    capabilities: row.capabilities,
    payoutSchedule: row.payout_schedule,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

merchantsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT ${MERCHANT_FIELDS} FROM merchants
       ORDER BY (status = 'verified') DESC, name ASC`,
    );

    let accounts = new Map();
    if (stripeConfigured) {
      try {
        const list = await getStripe().accounts.list({ limit: 100 });
        accounts = new Map(list.data.map((a) => [a.id, readableAccountStatus(a)]));
      } catch (err) {
        console.error("Failed to refresh account statuses:", err.message);
      }
    }

    res.json({
      data: result.rows.map((row) =>
        shapeMerchant(row, {
          connectedStatus: row.stripe_account_id ? accounts.get(row.stripe_account_id) : undefined,
        }),
      ),
    });
  }),
);

merchantsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = optionalString(req.body?.name);
    const email = optionalString(req.body?.email);
    if (!name || !email) {
      throw new HttpError(400, "name and email are required", "invalid_merchant");
    }

    // Programmatic custom-account onboarding (no user signup flow).
    let stripeAccountId = null;
    let status = "pending";
    let statusReason = null;
    if (stripeConfigured) {
      try {
        const account = await createConnectedAccount({ name, email });
        stripeAccountId = account.id;
        status = readableAccountStatus(account);
      } catch (err) {
        // e.g. Stripe Connect is not enabled on the platform account yet
        // ("You can only create new accounts if you've signed up for Connect").
        // Fall back to a simulated row so the marketplace + status demo stays
        // functional; real payouts require enabling Connect.
        statusReason =
          err?.raw?.message ||
          `Connect account creation failed: ${err?.message || err}`;
        console.warn(`[merchants] simulated merchant for "${name}" (${statusReason})`);
      }
    } else {
      console.warn(
        "[merchants] Stripe not configured — creating a simulated merchant row. Set STRIPE_SECRET_KEY for real account creation.",
      );
    }

    const result = await query(
      `INSERT INTO merchants (name, email, stripe_account_id, status, status_reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${MERCHANT_FIELDS}`,
      [name, email, stripeAccountId, status, statusReason],
    );

    res.status(201).json({ data: shapeMerchant(result.rows[0]) });
  }),
);

merchantsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT ${MERCHANT_FIELDS} FROM merchants WHERE id = $1`,
      [Number(req.params.id)],
    );
    if (!result.rows[0]) {
      throw new HttpError(404, "Merchant not found", "merchant_not_found");
    }
    const row = result.rows[0];

    let connectedStatus;
    if (row.stripe_account_id && stripeConfigured) {
      const account = await getStripe().accounts.retrieve(row.stripe_account_id);
      connectedStatus = readableAccountStatus(account);
    }

    const productCount = await query(
      "SELECT count(*)::int AS total FROM products WHERE merchant_id = $1",
      [row.id],
    );

    res.json({
      data: shapeMerchant(row, { connectedStatus }),
      productCount: productCount.rows[0].total,
    });
  }),
);

/**
 * Verification simulation: drive a merchant through a desired stored state.
 * In production this would follow real Stripe requirements; here we persist a
 * simulated status so the UI + payout-guard logic can be demonstrated.
 */
merchantsRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const status = optionalString(req.body?.status);
    const reason = optionalString(req.body?.reason);
    if (!["verified", "failed", "restricted"].includes(status || "")) {
      throw new HttpError(400, "status must be verified | failed | restricted", "invalid_status");
    }

    const result = await query(
      `UPDATE merchants SET status = $2, status_reason = $3
       WHERE id = $1
       RETURNING ${MERCHANT_FIELDS}`,
      [Number(req.params.id), status, reason || null],
    );
    if (!result.rows[0]) {
      throw new HttpError(404, "Merchant not found", "merchant_not_found");
    }

    console.log(`[merchants] simulated status ${result.rows[0].name} -> ${status}`);
    res.json({ data: shapeMerchant(result.rows[0]) });
  }),
);