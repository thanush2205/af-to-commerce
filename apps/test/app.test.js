import test from "node:test";
import assert from "node:assert/strict";

let server;
let base;

test.before(async () => {
  process.env.NODE_ENV = "test";
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