import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const allowedRoot = path.join(projectRoot, "test-data");
const dataDirectory = path.resolve(
  process.env.SERENDIPITY_DATA_DIR ??
    path.join(allowedRoot, "e2e"),
);
const databaseDirectory = path.join(dataDirectory, "data");

if (!dataDirectory.startsWith(`${allowedRoot}${path.sep}`)) {
  throw new Error("Refusing to clean data outside the project test-data directory.");
}

fs.mkdirSync(databaseDirectory, { recursive: true });
for (const entry of fs.readdirSync(databaseDirectory)) {
  const entryPath = path.join(databaseDirectory, entry);
  if (fs.statSync(entryPath).isFile()) {
    fs.chmodSync(entryPath, 0o666);
  }
  fs.rmSync(entryPath, { recursive: true, force: true });
}
