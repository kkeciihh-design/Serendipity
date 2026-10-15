import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { assertTestDataPath, assertTestDataTree } from "./test-data-safety.mjs";

const sample = assertTestDataPath(path.resolve("test-data/phase16-samples/normal.png"));
if (!fs.existsSync(sample)) {
  const generated = spawnSync(process.execPath, ["scripts/create-phase16-samples.mjs"], { stdio: "inherit", windowsHide: true });
  if (generated.status !== 0) process.exit(generated.status ?? 1);
}
const output = assertTestDataTree(path.resolve("test-data/verification-output/phase16-offline"));
fs.mkdirSync(output, { recursive: true });
const log = assertTestDataPath(path.join(output, `network-${Date.now()}.jsonl`));
fs.writeFileSync(log, "", { flag: "wx" });
const checked = spawnSync(process.execPath, ["scripts/run-isolated-tests.mjs", "tests/ticket-ocr-offline.test.ts", "--maxWorkers=1"], {
  stdio: "inherit", windowsHide: true,
  env: {
    ...process.env,
    NODE_OPTIONS: `--import=${pathToFileURL(path.resolve("scripts/verification/deny-ocr-network.mjs")).href}`,
    SERENDIPITY_VERIFY_OCR_OFFLINE: "1", SERENDIPITY_OCR_NETWORK_LOG: log,
  },
});
console.log(`Node API-level OCR network verification: ${path.relative(process.cwd(), log)}`);
process.exit(checked.status ?? 1);
