import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: resolve(__dirname, "../../.env"), quiet: true });
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
dotenv.config({ quiet: true });

const DEFAULT_RETRIES = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;

function envNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  api: {
    baseUrl: process.env.HOMESOME_API_BASE_URL ?? "https://user-api.gethomesome.com",
    key: process.env.HOMESOME_API_KEY ?? process.env.SHM_API_KEY,
    location: process.env.HOMESOME_LOCATION,
    pricelist: process.env.HOMESOME_PRICELIST,
  },

  output: {
    dir: process.env.SCRAPER_OUTPUT_DIR ?? resolve(__dirname, "../output"),
    file: process.env.SCRAPER_OUTPUT_FILE ?? "products.json",
    summaryFile: process.env.SCRAPER_SUMMARY_FILE ?? "summary.json",
  },

  request: {
    timeoutMs: envNumber(process.env.SCRAPER_TIMEOUT_MS, 60_000),
    maxRetries: envNumber(process.env.SCRAPER_MAX_RETRIES, DEFAULT_RETRIES),
    retryBaseDelayMs: envNumber(
      process.env.SCRAPER_RETRY_BASE_DELAY_MS,
      DEFAULT_RETRY_BASE_DELAY_MS
    ),
  },

  data: {
    currency: process.env.SCRAPER_CURRENCY ?? "CAD",
    catalogListType: process.env.HOMESOME_LIST_TYPE ?? "ui",
  },

  image: {
    baseUrl:
      process.env.HOMESOME_IMAGE_BASE_URL ??
      "https://s3-us-west-2.amazonaws.com/www.gethomesome.com",
  },
};

export function assertConfig() {
  const missing = [];
  if (!config.api.key || config.api.key === "change-me") {
    missing.push("HOMESOME_API_KEY");
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        "Copy .env.example to .env at the repository root and set HOMESOME_API_KEY."
    );
  }
}