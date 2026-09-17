import "./env.js";
import { fileURLToPath } from "node:url";
import { createEsClient, ELASTICSEARCH_INDEX } from "./client.js";
import { runSearch } from "./search.js";

function print(title, result) {
  console.log(`\n--- ${title} ---`);
  console.log(`total: ${result.total} | showing ${result.hits.length} (page ${result.page.from})`);
  for (const hit of result.hits) {
    const price = hit.price != null ? `$${hit.price} ${hit.currency ?? ""}`.trim() : "-";
    console.log(`  [${hit.category ?? "?"} / ${hit.subcategory ?? "?"}] ${hit.name} | ${price} | ${hit.availability}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = createEsClient();

  const demo = [
    { title: "full-text: 'apple juice'", opts: { q: "apple juice", size: 5 } },
    { title: "full-text: 'organic'", opts: { q: "organic", size: 5 } },
    { title: "category filter: Beverages", opts: { category: "Beverages", size: 5 } },
    { title: "price asc: frozen", opts: { q: "pizza", sort: "price", order: "asc", size: 5 } },
    { title: "in-stock + under $5", opts: { availability: "in_stock", maxPrice: 5, sort: "price", order: "asc", size: 5 } },
    { title: "pagination page 2 (from=5)", opts: { q: "bread", from: 5, size: 5 } },
  ];

  try {
    const index = process.env.ELASTICSEARCH_INDEX ?? ELASTICSEARCH_INDEX;
    for (const { title, opts } of demo) {
      const result = await runSearch(client, index, opts);
      print(title, result);
    }
  } catch (error) {
    console.error(`[es] smoke FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    await client.close();
  }
}