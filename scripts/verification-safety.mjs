import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { assertTestDataPath, assertTestDataTree } from "./test-data-safety.mjs";

export function assertSafeTestWorkspace(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot, "test-data");
  // This also validates test-data and every existing ancestor when empty.
  assertTestDataPath(path.join(root, ".verification-boundary"), projectRoot);
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root)) {
      assertTestDataTree(path.join(root, entry), projectRoot);
    }
  }
  return root;
}

export function requireExternalVerification({ base, dataDirectories = [] } = {}) {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== "--allow-external") {
    throw new Error("这是会访问真实外部服务的历史实测入口，默认停止。当前离线验收请运行 npm test 或 npm run test:e2e；已明确需要外部实测时，传入 --allow-external，并先准备匹配的隔离数据库和服务。");
  }
  if (base) {
    const origin = new URL(base);
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.origin !== base) {
      throw new Error("External verification requires an explicit loopback server origin.");
    }
  }
  for (const directory of dataDirectories) assertTestDataTree(path.resolve(directory));
}
