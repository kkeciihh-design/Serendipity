import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readTravelBackup, readInstanceState } from "./restore-core.mjs";
import { assertTestDataPath } from "./test-data-safety.mjs";

const output = assertTestDataPath(path.resolve("test-data/verification-output/phase30"));
const source = assertTestDataPath(path.resolve("test-data/phase30-live/data/serendipity.db"));
const target = assertTestDataPath(path.resolve("test-data/phase30-restored"));
const targetDb = path.join(target, "data/serendipity.db");
const config = path.join(output, "restore-launcher.json");
const filename = path.join(output, "recoverable-travel-backup.json");
const hash = (v) => createHash("sha256").update(v).digest("hex");
async function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true }); let stdout = "", stderr = "";
    child.stdout.on("data", (s) => { stdout += s; }); child.stderr.on("data", (s) => { stderr += s; });
    child.once("error", reject); child.once("exit", (code) => { if (code !== 0) reject(new Error(`Verification command failed: ${stderr}`)); else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Expected structured verification response")); } } });
  });
}
await fs.writeFile(config, JSON.stringify({ version: 1, projectRoot: process.cwd(), dataDirectory: target, nodePath: process.execPath, buildDirectory: ".next-phase30-verified", preferredPort: 3143 }));
const backup = readTravelBackup(source); await fs.writeFile(filename, JSON.stringify(backup));
const started = await run(["scripts/desktop-control.mjs", "start", "--config", config]); assert.equal(started.ok, true);
try {
  const original = readTravelBackup(targetDb); assert.equal(original.tables.Trip.length, 0, "Restore target must be the new empty isolated instance");
  const oldGeneration = readInstanceState(targetDb).dataGeneration;
  const preview = await run(["scripts/technical-restore.mjs", target, filename]); assert.equal(path.resolve(preview.target), path.resolve(targetDb));
  const result = await run(["scripts/technical-restore.mjs", target, filename, "--confirm", preview.confirmation]);
  const restored = readTravelBackup(targetDb); assert.deepEqual(restored.tables, backup.tables);
  const state = readInstanceState(targetDb); assert.notEqual(state.dataGeneration, oldGeneration); assert.equal(state.activeRestoreId, null);
  const stale = await fetch(`${started.url}/api/trips`, { method: "POST", headers: { Origin: started.url, "Content-Type": "application/json", "x-data-generation": oldGeneration }, body: JSON.stringify({ originalRequest: "Old generation must not write" }) }); assert.equal(stale.status, 409);
  const trip = restored.tables.Trip[0], plan = restored.tables.PlanVersion.find((p) => p.id === trip.currentPlanVersionId);
  const exported = await fetch(`${started.url}/api/trips/${trip.id}/exports`, { method: "POST", headers: { Origin: started.url, "Content-Type": "application/json", "x-data-generation": state.dataGeneration }, body: JSON.stringify({ expectedPlanVersion: plan.versionNumber, format: "plain-text", options: {} }) }); assert.equal(exported.status, 201);
  const file = (await exported.json()).file;
  const downloaded = await (await fetch(`${started.url}/api/trips/${trip.id}/exports/${file.id}`)).text(); assert.ok(downloaded.includes("2026-10-29"));
  assert.deepEqual(readTravelBackup(source).tables, backup.tables);
  await fs.writeFile(path.join(output, "restore-results.json"), JSON.stringify({ at: new Date().toISOString(), backupSha256: hash(JSON.stringify(backup)), tableCounts: Object.fromEntries(Object.entries(backup.tables).map(([table, rows]) => [table, rows.length])), tableHashes: Object.fromEntries(Object.entries(backup.tables).map(([table, rows]) => [table, hash(JSON.stringify(rows))])), sourceUnchanged: true, restoredTablesIdentical: true, oldGenerationRejected: true, regeneratedExport: file, result }, null, 2));
  console.log(JSON.stringify({ passed: true, trips: backup.tables.Trip.length, planVersions: backup.tables.PlanVersion.length, restoredTablesIdentical: true, oldGenerationRejected: true }));
} finally { const stopped = await run(["scripts/desktop-control.mjs", "stop", "--config", config]); assert.equal(stopped.ok, true); }
