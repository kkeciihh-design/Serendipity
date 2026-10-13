import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertTestDataPath, assertTestDataTree } from "../../scripts/test-data-safety.mjs";

export function isolatedDatabase(name: string) {
  const root = path.resolve("test-data");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name)) throw new Error("Invalid isolated database name.");
  assertTestDataPath(path.join(root, `${name}-`));
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, `${name}-`));
  fs.mkdirSync(path.join(directory, "data"));
  const databaseUrl = `file:${path.join(directory, "data", "serendipity.db").replaceAll("\\", "/")}`;
  process.env.SERENDIPITY_DATA_DIR = directory;
  const result = spawnSync(process.execPath, [
    path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy",
  ], { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Isolated migrations failed: ${result.stderr}`);
  return { directory, databaseUrl, cleanup() {
    assertTestDataTree(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  } };
}
