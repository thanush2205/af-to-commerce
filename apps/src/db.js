/**
 * PostgreSQL connection (source of truth).
 */

import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  // Idle client errors must not crash the process; the next query reconnects.
  console.error("pg pool error:", err.message);
});

export function query(text, params = []) {
  return pool.query(text, params);
}

export async function closePool() {
  await pool.end();
}