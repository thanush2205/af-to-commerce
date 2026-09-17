import "./env.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createEsClient, ELASTICSEARCH_INDEX } from "./client.js";
import { ensureIndex } from "./ensure-index.js";
import { slugify } from "./slug.js";

const DEFAULT_SOURCE = fileURLToPath(
  new URL("../../scraper/output/products.json", import.meta.url)
);

const BULK_BATCH = 500;

function toDocument(product) {
  const { description, ...rest } = product;
  return {
    ...rest,
    description: description ?? "",
    slug: slugify(product.name),
    price: Number(product.price) || 0,
    organic: Boolean(product.organic),
    unitQuantity: product.unitQuantity != null ? Number(product.unitQuantity) : null,
    minQuantity: product.minQuantity != null ? Number(product.minQuantity) : null,
    maxQuantity: product.maxQuantity != null ? Number(product.maxQuantity) : null,
  };
}

/**
 * Flatten the grouped scraper output ( [{category, subcategory, products}...] )
 * into one top-level list of documents. Each product already carries its
 * category/subcategory from the scraper transform.
 */
function flatten(groups) {
  const products = [];
  for (const group of groups) {
    for (const product of group.products ?? []) {
      products.push(product);
    }
  }
  return products;
}

function parseArgs(argv) {
  const args = { index: ELASTICSEARCH_INDEX, source: DEFAULT_SOURCE, limit: null };
  for (const arg of argv) {
    if (arg.startsWith("--index=")) args.index = arg.slice("--index=".length);
    else if (arg.startsWith("--file=")) args.source = arg.slice("--file=".length);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }
  return args;
}

export async function indexProducts(client, index, sourcePath, limit) {
  await ensureIndex(client, index, false);

  const raw = await readFile(sourcePath, "utf8");
  const groups = JSON.parse(raw);
  const products = flatten(groups);
  const docs = products
    .slice(0, limit ?? products.length)
    .map((p) => toDocument(p));

  if (docs.length === 0) {
    return { total: 0, indexed: 0, failed: 0, batches: 0 };
  }

  const operations = [];
  for (const doc of docs) {
    operations.push({ index: { _index: `${index}`, _id: doc.sku } });
    operations.push(doc);
  }

  let indexed = 0;
  let failed = 0;
  const batches = [];

  for (let i = 0; i < operations.length; i += BULK_BATCH * 2) {
    const chunk = operations.slice(i, i + BULK_BATCH * 2);
    const response = await client.bulk({ operations: chunk, refresh: false });
    const errors = response.errors ? response.items.filter((item) => item.index.error) : [];
    indexed += chunk.length / 2 - errors.length;
    failed += errors.length;
    batches.push(
      errors.length === 0
        ? `batch ${i / (BULK_BATCH * 2) + 1}: ok (${chunk.length / 2} docs)`
        : `batch ${i / (BULK_BATCH * 2) + 1}: ${errors.length} failed`
    );
  }

  return { total: docs.length, indexed, failed, batches };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const client = createEsClient();
  try {
    const result = await indexProducts(client, args.index, args.source, args.limit);
    console.log(`[es] source products read: ${result.total}`);
    console.log(
      `[es] indexed ${result.indexed}/${result.total} into "${args.index}" (failed: ${result.failed})`
    );
    console.log(`[es] ${result.batches.join(" | ")}`);
  } catch (error) {
    console.error(`[es] FAILED to index products: ${error.message}`);
    process.exit(1);
  } finally {
    await client.close();
  }
}