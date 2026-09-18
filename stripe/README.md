# Stripe — Checkout & Connect fund flows

The Stripe client + checkout helpers live in the Node API
(`apps/src/stripe.js`); this directory documents the **money movement**, the
two implemented fund flows, and what happens to each account's balance.

> Assignment surface: Test Mode Checkout Sessions, a demo merchant (Custom
> Connected) platform, Payment Intents, an order confirmation page, and two
> Stripe Connect fund flows. Everything here is test-mode only.

## Actors

```
PLATFORM  (your main Stripe account, sk_test_...)
   │
   └── Stripe Connect (Custom Connected Accounts)
          ├── Maple Acres Farms     (acct_...)
          ├── Harbord Grocers      (acct_...)
          └── Riverside Naturals  (acct_...)
```

- **Platform** = the operator. Creates connected accounts, runs checkout,
  takes the platform fee, and can issue Transfers.
- **Merchants** = Custom Connected Accounts. Fully API-controlled; products in
  the catalog are linked to a merchant via `products.merchant_id`.

## 12.1 Checkout flow (Sections 12–15 in one diagram)

```
User ──> Cart ──> /checkout ──> POST /api/checkout (sku + quantity ONLY)
                                  │
                                  ▼
                            Node API (PostgreSQL re-read)
                                  │  authoritative price × quantity
                                  ▼
                            calculatePlatformFee(total)   (Section 14)
                                  │
                                  ▼
                        Stripe Checkout Session (url)
                                  │
                                  ▼
                            Stripe hosted Checkout (4242… test card)
                                  │ paid
                                  ▼
             webhook checkout.session.completed ──> orders (split applied)
                                  │
                                  ▼
          /checkout/success?session_id=… (authoritative amount + split)
```

### Never trust the frontend price (Section 12.2)

`POST /api/checkout` accepts **only** `{ items: [{ sku, quantity }] }`. Price,
availability and the total are re-fetched from PostgreSQL and converted to
minor units server-side (`buildLineItems`, `computeTotalMinor` in
`apps/src/stripe.js`). A body like `{ total: 9.99 }` is ignored — a tampered
cart simply re-prices itself.

## 14. Revenue share

`calculatePlatformFee(amountMinor)` maps an order total (cents) to a rate from
a tier table and returns exact integer splits. It is the *single* source used
by the checkout session, the webhook, `/split` and `/transfer`.

| Order amount | Platform | Example (order → platform / merchant) |
| ------------ | -------- | -------------------------------------- |
| > $100.00    | 10%      | $150.00 → $15.00 / $135.00             |
| $50–$100     | 15%      | $75.00  → $11.25 / $63.75              |
| < $50        | 20%      | $40.00  → $8.00  / $32.00              |

## 15. Fund flow #1 — Destination charges

Used when a cart maps to a single **verified** merchant
(`resolveMerchantSession`). The Checkout Session is created with:

```
payment_intent_data.transfer_data.destination = acct_<merchant>
payment_intent_data.application_fee_amount   = platform fee
```

```
Customer
   │  $100 (card)
   ▼
Platform
   │
   ├── application_fee_amount  $15   (platform fee, taken at capture)
   │
   └── transfer_data           $85   (rest settles onto the connected account)
          │
          ▼
  Connected Account balance  +$85
```

- Platform balance: grows by the fee. Connected account balance: grows by the
  merchant share. **No separate transfer call is needed.**
- Money destination is fixed at payment time — no later control.

## 15. Fund flow #2 — Separate charges and transfers

Used for any cart that is not a single verified merchant (multi-merchant,
unverified, or platform-owned). The payment runs **entirely on the platform**;
the merchant share is moved later with a `Transfer`.

```
Customer
   │  $100 (card)
   ▼
Platform (full $100 lands here)
   │
   │  (later) POST /api/orders/:sessionId/transfer
   │
   ├── platform keeps fee  $15
   │
   └── Transfer $85 ──► Connected Account (+$85 balance)
```

- Idempotency key `transfer:<session>:<merchant>` prevents double-paying a
  merchant on a retried request.
- Transfers are blocked unless the merchant is `verified`. The merchant is
  tagged on the session metadata even when the payment was a platform charge,
  so a restricted merchant's order can be settled after they verify.
- Platform-side escrow: the money sits in the platform balance until the
  merchant is payable — useful when you want settlement *control* or batching.

## What happens to balances

`GET /api/orders/:sessionId` returns the order row plus:

- `paymentIntent` — the authoritative Stripe Payment Intent (amount, status,
  `application_fee_amount`, `transfer_data`)
- `split` — the computed platform fee / merchant share (Section 14)
- `transfer` — the Transfer for this session group, if one was issued
- `balances` — live `available` balances for the **platform** and the
  **connected merchant** accounts, so you can watch money move from one to the
  other after a destination charge or transfer.

## Demo script

```bash
# 1. Seed the marketplace (idempotent): creates 3 merchants and links every
#    unassigned product across them:
cd apps && npm run seed:marketplace

# 2. With a test key + `stripe listen --forward-to localhost:8000/api/stripe/webhook`:
#    - check out a single-merchant cart  -> destination charge
#    - check out a multi-merchant cart   -> platform charge, then settle via
POST /api/orders/<session>/transfer

# 3. Revenue share:
POST /api/orders/<session>/split

# 4. Inspect Payment Intent + balances:
GET  /api/orders/<session>
```