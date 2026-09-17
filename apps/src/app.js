/**
 * Express application wiring. Exported separately from the HTTP server so the
 * integration path is testable in-process.
 */

import express from "express";
import { HttpError } from "./util.js";
import { productsRouter } from "./routes/products.js";
import { categoriesRouter } from "./routes/categories.js";
import { searchRouter } from "./routes/search.js";

export const app = express();

app.disable("x-powered-by");
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
      "GET /healthz",
    ],
  });
});

app.use("/api/products", productsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/search", searchRouter);

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