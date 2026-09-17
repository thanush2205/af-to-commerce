import "./env.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createEsClient, ELASTICSEARCH_INDEX } from "./client.js";

const MAPPING_PATH = fileURLToPath(
  new URL("../mappings/product.index.json", import.meta.url)
);

function parseArgs(argv) {
  const args = { force: false, index: ELASTICSEARCH_INDEX };
  for (const arg of argv) {
    if (arg === "--force") args.force = true;
    else if (arg.startsWith("--index=")) args.index = arg.slice("--index=".length);
  }
  return args;
}

/**
 * Create the product index on first run; skip when it already exists.
 * Pass `force: true` to delete and recreate (destructive).
 */
export async function ensureIndex(client, index = ELASTICSEARCH_INDEX, force = false) {
  const raw = await readFile(MAPPING_PATH, "utf8");
  const body = JSON.parse(raw);

  const exists = await client.indices.exists({ index }).then(Boolean).catch(() => false);

  if (exists && !force) {
    return { created: false, action: "exists", index };
  }

  if (exists && force) {
    await client.indices.delete({ index });
  }

  await client.indices.create({ index, ...body });
  return { created: true, action: force ? "recreated" : "created", index };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const client = createEsClient();
  try {
    const result = await ensureIndex(client, args.index, args.force);
    console.log(`[es] index "${args.index}" ${result.action}`);

    const state = await client.indices.get({ index: args.index });
    const name = Object.keys(state)[0];
    const settings = state[name].settings.index;
    const fields = Object.keys(state[name].mappings.properties ?? {});
    console.log(
      `[es] settings: shards=${settings.number_of_shards}, replicas=${settings.number_of_replicas}`
    );
    console.log(`[es] mapped fields (${fields.length}): ${fields.join(", ")}`);
  } catch (error) {
    console.error(`[es] FAILED to ensure index: ${error.message}`);
    process.exit(1);
  } finally {
    await client.close();
  }
}