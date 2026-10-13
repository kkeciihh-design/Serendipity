import fs from "node:fs";
import path from "node:path";
import { assertTestDataPath, assertTestDataTree } from "./test-data-safety.mjs";

const projectRoot = process.cwd();
const allowedRoot = path.join(projectRoot, "test-data");
const dataDirectory = path.resolve(
  process.env.SERENDIPITY_DATA_DIR ??
    path.join(allowedRoot, "e2e"),
);
const databaseDirectory = path.join(dataDirectory, "data");

assertTestDataPath(dataDirectory, projectRoot);
assertTestDataTree(databaseDirectory, projectRoot);

fs.mkdirSync(databaseDirectory, { recursive: true });
for (const entry of fs.readdirSync(databaseDirectory)) {
  const entryPath = path.join(databaseDirectory, entry);
  if (fs.lstatSync(entryPath).isFile()) {
    fs.chmodSync(entryPath, 0o666);
  }
  fs.rmSync(entryPath, { recursive: true, force: true });
}
