/**
 * Marketplace seed (Stage 4 — Stripe Connect demo).
 *
 *   npm run seed:marketplace
 *
 * Creates three demo merchants and links every currently-unassigned product
 * to one of them (round-robin), so a real cart maps to a single merchant and
 * the destination-charge / transfer fund flows can be demonstrated.
 *
 * Idempotent by design:
 *   - merchants are upserted by name (existing rows keep their stripe account)
 *   - products are only assigned while `merchant_id` is NULL, so a re-run
 *     never re-parents a product that already has a merchant
 *
 * Merge mode: with STRIPE_SECRET_KEY set, each merchant gets a real Custom
 * Connected Account (acct_...) and the rows are stored as `verified` so the
 * demo payouts aren't blocked. Without a key (local/demo), merchants get a
 * stable simulated account id (acct_sim_...) — checkout still returns 503
 * stripe_not_configured until a key is set, which is documented behaviour.
 */

import "dotenv/config";
import { pool } from "../src/db.js";
import { createConnectedAccount, getStripe, stripeConfigured } from "../src/stripe.js";

const MERCHANTS = [
  { name: "Maple Acres Farms", email: "accounts@mapleacres.demo", slug: "maple-acres" },
  { name: "Harbord Grocers", email: "grocers@harbord.demo", slug: "harbord-grocers" },
  { name: "Riverside Naturals", email: "hello@riversidenaturals.demo", slug: "riverside-naturals" },
];

async function upsertMerchant({ name, email, slug }) {
  const existing = await pool.query(
    "SELECT id, stripe_account_id FROM merchants WHERE name = $1",
    [name],
  );
  if (existing.rows[0]) {
    console.log(`merchant "${name}": already exists (id=${existing.rows[0].id})`);
    return existing.rows[0].id;
  }

  let stripeAccountId = `acct_sim_${slug}`;
  let status = "verified";
  let statusReason = "Simulated verification for the Stage 4 demo";
  if (stripeConfigured) {
    try {
      const account = await createConnectedAccount({ name, email });
      stripeAccountId = account.id;
      // Demo: mark the merchant verified so payouts are allowed. Real
      // onboarding requirements are surfaced by GET /api/merchants/:id.
      status = "verified";
      statusReason = null;
      console.log(`merchant "${name}": created Connected Account ${account.id}`);
    } catch (err) {
      status = "pending";
      statusReason = `Stripe account creation failed: ${err?.message || err}. Falling back to simulated account.`;
      console.warn(statusReason);
    }
  } else {
    console.log(`merchant "${name}": no STRIPE_SECRET_KEY — simulated account ${stripeAccountId}`);
  }

  const result = await pool.query(
    `INSERT INTO merchants (name, email, stripe_account_id, status, status_reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, email, stripeAccountId, status, statusReason],
  );
  console.log(`merchant "${name}": created id=${result.rows[0].id} account=${stripeAccountId} status=${status}`);
  return result.rows[0].id;
}

async function assignProducts(merchantIds) {
  const unassigned = await pool.query(
    `SELECT id FROM products
      WHERE merchant_id IS NULL AND is_active = true
      ORDER BY id`,
  );
  const ids = unassigned.rows.map((r) => r.id);
  if (ids.length === 0) {
    console.log("no unassigned products — nothing to link");
    return 0;
  }

  // Round-robin so each merchant owns roughly one third of the catalog.
  let assigned = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const merchantId = merchantIds[i % merchantIds.length];
    await pool.query("UPDATE products SET merchant_id = $1 WHERE id = $2", [
      merchantId,
      ids[i],
    ]);
    assigned += 1;
  }
  return assigned;
}

async function main() {
  const merchantIds = [];
  for (const m of MERCHANTS) merchantIds.push(await upsertMerchant(m));

  const assigned = await assignProducts(merchantIds);
  console.log(`linked ${assigned} products to ${merchantIds.length} merchants`);

  const summary = await pool.query(
    `SELECT m.id, m.name, m.status, m.stripe_account_id,
            count(p.id)::int AS products
       FROM merchants m
       LEFT JOIN products p ON p.merchant_id = m.id
      WHERE m.name = ANY($1)
      GROUP BY m.id ORDER BY m.id`,
    [MERCHANTS.map((m) => m.name)],
  );
  console.table(summary.rows.map((r) => ({ ...r, stripe_account_id: `${String(r.stripe_account_id).slice(0, 12)}…` })));
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    pool.end();
    process.exit(1);
  });