import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assertConfig, config } from "./config.js";
import { log } from "./logger.js";
import { fetchCatalog } from "./api.js";
import { groupByCategoryAndSubcategory, summarize, toProduct } from "./transform.js";
import { jsonFile, writeJsonAtomic } from "./write.js";

function parseArgs(argv) {
  const opts = { outDir: config.output.dir, limit: Infinity };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--out":
      case "--out-dir":
        opts.outDir = resolve(argv[i + 1]);
        i += 1;
        break;
      case "--limit":
        opts.limit = Number.parseInt(argv[i + 1], 10);
        i += 1;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        break;
    }
  }
  return opts;
}

function usage() {
  return `
Summerhill Market catalog scraper

Usage:
  npm run scrape [-- --out <dir>] [-- --limit <n>]

Options:
  --out <dir>     Output directory (default: <package>/output)
  --limit <n>     Limit product count (for smoke-testing)
  -h, --help      Show this help
`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }

  assertConfig();

  const run = { id: randomUUID().slice(0, 8), startedAt: new Date().toISOString() };
  log.info("scrape started", { runId: run.id });

  await mkdir(opts.outDir, { recursive: true });

  const payload = await fetchCatalog();
  const rawProducts = payload.products ?? [];

  log.info("catalog fetched", {
    total: rawProducts.length,
    promotions: Array.isArray(payload.promotions) ? payload.promotions.length : 0,
  });

  const products = rawProducts.slice(0, opts.limit).map(toProduct);
  const groups = groupByCategoryAndSubcategory(products);

  const productsPath = resolve(opts.outDir, config.output.file);
  const summaryPath = resolve(opts.outDir, config.output.summaryFile);

  await writeJsonAtomic(productsPath, groups);
  run.finishedAt = new Date().toISOString();

  const summary = summarize(products, groups, run);
  await writeJsonAtomic(summaryPath, summary);

  log.info("scrape finished", {
    runId: run.id,
    products: summary.productCount,
    groups: summary.categoryGroups,
    out: productsPath,
  });

  process.stdout.write(
    `\nWrote ${summary.productCount} products (${summary.categoryGroups} category/subcategory groups) to ${productsPath}\n`
  );
}

main().catch((err) => {
  log.error("scrape failed", { message: err.message, stack: err.stack });
  process.exitCode = 1;
});