/**
 * Express application wiring. Exported separately from the HTTP server so the
 * integration path is testable in-process.
 */

import express from "express";
import { HttpError } from "./util.js";
import { productsRouter } from "./routes/products.js";
import { categoriesRouter } from "./routes/categories.js";
import { searchRouter } from "./routes/search.js";
import { checkoutRouter } from "./routes/checkout.js";
import { webhookRouter } from "./routes/webhook.js";
import { merchantsRouter } from "./routes/merchants.js";
import { transfersRouter } from "./routes/transfers.js";

export const app = express();

app.disable("x-powered-by");

// Browser origins allowed to call the API cross-origin (dev: web on :3000/:3001,
// API on :8000). Storefront pages render server-side so GETs need no CORS; the
// cart/checkout fetches run in the browser and POSTs preflight.
const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
  }
  next();
});

// Stripe webhooks must read the RAW body to verify the signature, so the
// webhook router is registered BEFORE express.json() parses (and consumes) it.
app.use("/api/stripe/webhook", webhookRouter);

app.use(express.json());

if (process.env.NODE_ENV !== "test") {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      console.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`,
      );
    });
    next();
  });
}

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api", (_req, res) => {
  res.json({
    name: "AF-TO Commerce API",
    version: "1.0.0",
    endpoints: [
      "GET /api/products?category=&subcategory=&sort=&page=&limit=",
      "GET /api/products/:id    (id | slug | sku)",
      "GET /api/categories",
      "GET /api/search?q=&sort=&order=&page=&limit=",
      "POST /api/checkout  (Stripe Checkout Session; prices from PostgreSQL)",
      "GET /api/checkout/session/:id",
      "POST /api/stripe/webhook",
      "GET  /api/merchants",
      "POST /api/merchants",
      "PATCH /api/merchants/:id/status",
      "GET  /api/orders/:sessionId  (order + PaymentIntent + split + balances)",
      "POST /api/orders/:sessionId/split",
      "POST /api/orders/:sessionId/transfer",
      "GET /healthz",
    ],
  });
});

app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/search", searchRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/merchants", merchantsRouter);
app.use("/api/orders", transfersRouter);

// 404s stay JSON, never HTML.
app.use((_req, res) => {
  res.status(404).json({
    error: { code: "not_found", message: "Route not found" },
  });
});

// Central error handler: always JSON, never leaks a stack in production.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: {
      code: err.code || "internal_error",
      message: status >= 500 ? "Internal server error" : err.message,
    },
  });
});