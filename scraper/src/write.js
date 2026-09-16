import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function atomicTempPath(target) {
  return join(dirname(target), `.${Date.now()}.${process.pid}.tmp`);
}

export async function writeJsonAtomic(target, data) {
  await mkdir(dirname(target), { recursive: true });
  const tmp = atomicTempPath(target);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

export function jsonFile(dir, name) {
  return join(dir, name);
}