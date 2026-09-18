/**
 * Apply the versioned catalog migrations (database/migrations/up) to DATABASE_URL.
 *
 * Runs each file inside its own transaction and records it in a `_migrations`
 * table, so re-runs are safe (idempotent) and failures roll back cleanly.
 *
 *   DATABASE_URL=postgresql://... npm run migrate
 */

import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const UP_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../database/migrations/up"
);

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/afcommerce";

const pool = new Pool({
  connectionString,
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

async function appliedMigrations() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  );
  const { rows } = await pool.query("SELECT name FROM _migrations");
  return new Set(rows.map((row) => row.name));
}

async function applyFile(name, sqlPath) {
  const sql = await readFile(sqlPath, "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  const files = (await readdir(UP_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const done = await appliedMigrations();
  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    if (done.has(file)) {
      console.log(`[migrate] skip  ${file} (already applied)`);
      skipped += 1;
      continue;
    }
    console.log(`[migrate] apply ${file}`);
    await applyFile(file, resolve(UP_DIR, file));
    applied += 1;
  }

  console.log(`[migrate] done: ${applied} applied, ${skipped} skipped, ${files.length} total`);
} catch (error) {
  console.error(`[migrate] FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}