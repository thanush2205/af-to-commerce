/**
 * Environment-driven configuration.
 *
 * All values fall back to the same defaults the compose `x-app-environment`
 * block injects, so the API runs out of the box and matches the other sections.
 */

import "dotenv/config";

export const config = {
  env: process.env.APP_ENV || "development",
  port: Number(process.env.PORT) || 8000,
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/afcommerce",
  elasticsearch: {
    url: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
    index: process.env.ELASTICSEARCH_INDEX || "products",
    // Optional: only sent when the deployment is security-enabled
    // (e.g. Elastic Cloud). The local compose stack needs no key.
    apiKey: process.env.ELASTICSEARCH_API_KEY || "",
  },
};

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;