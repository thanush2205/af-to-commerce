import test from "node:test";
import assert from "node:assert/strict";

let server;
let base;

test.before(async () => {
  process.env.NODE_ENV = "test";
  // Pin the allowlist so this suite never depends on ambient CORS_ORIGINS.
  process.env.CORS_ORIGINS = "http://localhost:3000,http://localhost:3001";
  const { app } = await import("../src/app.js");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("GET /healthz returns ok", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(typeof body.uptime, "number");
});

test("GET /api lists the route map", async () => {
  const res = await fetch(`${base}/api`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "AF-TO Commerce API");
  assert.ok(body.endpoints.length >= 4);
});

test("unknown routes return JSON 404", async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.error.code, "not_found");
});

test("bad method returns JSON 404 not crash", async () => {
  const res = await fetch(`${base}/api/products`, { method: "PUT" });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("content-type").includes("application/json"), true);
});

test("allowlisted browser origins get CORS headers; POST preflights pass", async () => {
  for (const origin of ["http://localhost:3000", "http://localhost:3001"]) {
    const preflight = await fetch(`${base}/api/checkout`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204, `preflight from ${origin}`);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
  }
});

test("non-allowlisted origins get no CORS headers", async () => {
  const res = await fetch(`${base}/api/checkout`, {
    method: "OPTIONS",
    headers: { Origin: "http://evil.example.com", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});