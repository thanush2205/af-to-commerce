import { setDefaultResultOrder } from "node:dns";
import { Client } from "@elastic/elasticsearch";

// On some systems (Windows desktop, some CI runners) `localhost` resolves to
// ::1 first while Elasticsearch only binds IPv4, which makes every request
// hang until the timeout. Prefer IPv4 so tooling works everywhere.
setDefaultResultOrder("ipv4first");

export const ELASTICSEARCH_INDEX =
  process.env.ELASTICSEARCH_INDEX ?? "products";

function baseUrl() {
  if (process.env.ELASTICSEARCH_URL) {
    return process.env.ELASTICSEARCH_URL;
  }
  const host = process.env.ELASTICSEARCH_HOST ?? "localhost";
  const port = process.env.ELASTICSEARCH_PORT ?? "9200";
  return `http://${host}:${port}`;
}

export function createEsClient() {
  const options = {
    node: baseUrl(),
    requestTimeout: 30_000,
  };
  if (process.env.ELASTICSEARCH_API_KEY) {
    options.auth = { apiKey: process.env.ELASTICSEARCH_API_KEY };
  }
  return new Client(options);
}