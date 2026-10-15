import { spawnSync } from "node:child_process";
const generated = spawnSync(process.execPath, ["scripts/create-phase16-samples.mjs"], { stdio: "inherit", windowsHide: true });
if (generated.status !== 0) process.exit(generated.status ?? 1);
const checked = spawnSync(process.execPath, ["scripts/run-isolated-tests.mjs", "tests/ticket-ocr-real.test.ts", "--maxWorkers=1"], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, SERENDIPITY_VERIFY_OCR: "1" },
});
process.exit(checked.status ?? 1);
