import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { assertTestDataPath } from "./test-data-safety.mjs";
import { readInstanceState } from "./restore-core.mjs";

const root = process.cwd();
const target = assertTestDataPath(path.resolve("test-data/phase29-launcher"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase29"));
fs.mkdirSync(output, { recursive: true });
const configFile = path.join(output, "launcher.json");
const config = { version: 1, projectRoot: root, dataDirectory: target, nodePath: process.execPath, buildDirectory: ".next-phase29-release", preferredPort: 3140 };
fs.writeFileSync(configFile, JSON.stringify(config));
const evidence = [];
function record(name, details = {}) { evidence.push({ name, passed: true, ...details }); console.log(`PASS ${name}`); }
async function run(action, file = configFile, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("scripts/desktop-control.mjs"), action, "--config", file], { cwd: root, env: { ...process.env, ...extraEnv }, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject); child.on("exit", () => { try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error(`Invalid controller output: ${stdout} ${stderr}`)); } });
  });
}
function fingerprint(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map((r) => JSON.stringify(r)).sort();
      return [name, { count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") }];
    }));
  } finally { db.close(); }
}
const formal = path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db");
const protectedBefore = fingerprint(formal);
const keyFile = path.join(process.env.LOCALAPPDATA, "Serendipity/security.key");
const keyHashBefore = createHash("sha256").update(fs.readFileSync(keyFile)).digest("hex");
let blocker;
try {
  assert.equal((await run("stop")).ok, true);
  const [first, second, third] = await Promise.all([run("start", configFile, { SERENDIPITY_DATA_DIR: "C:/invalid-inherited-data", SERENDIPITY_HOST: "0.0.0.0", SERENDIPITY_PUBLIC_ORIGIN: "https://invalid.example" }), run("start"), run("start")]);
  assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(second.pid, first.pid); assert.equal(third.pid, first.pid);
  record("three simultaneous cold starts share one instance", { pid: first.pid, url: first.url });
  const health = await (await fetch(`${first.url}/api/runtime`)).json();
  assert.equal(health.localOnly, true); assert.equal(health.dataDirectory, target); assert.equal(health.pid, first.pid);
  record("persisted config overrides inherited test/public environment");
  const state = JSON.parse(fs.readFileSync(path.join(target, "runtime/service.json")));
  for (const headers of [{}, { Authorization: "Bearer wrong" }, { Authorization: `Bearer ${state.token}`, Origin: "https://evil.example" }]) {
    assert.equal((await fetch(`http://127.0.0.1:${state.controlPort}/stop`, { method: "POST", headers })).status, 403);
  }
  assert.equal((await run("status")).status, "ready"); record("unauthenticated and cross-origin stop rejected");
  const foreignStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${first.url}/api/runtime`, { headers: { Host: "evil.example" } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.once("error", reject);
  });
  assert.equal(foreignStatus, 401); record("runtime metadata is protected by existing host/auth policy");
  const generation = (await (await fetch(`${first.url}/api/data-management/status`)).json()).dataGeneration;
  const created = await fetch(`${first.url}/api/trips`, { method: "POST", headers: { "Content-Type": "application/json", Origin: first.url, "x-data-generation": generation }, body: JSON.stringify({ originalRequest: "阶段29启动验收：杭州两日旅行，保留原话与旅行记录" }) });
  assert.equal(created.status, 201); const trip = (await created.json()).trip;
  const before = fingerprint(path.join(target, "data/serendipity.db"));
  assert.equal((await run("stop")).status, "stopped");
  await assert.rejects(fetch(`${first.url}/api/runtime`));
  assert.equal((await run("stop")).status, "stopped");
  const restarted = await run("start"); assert.equal(restarted.ok, true); assert.notEqual(restarted.pid, first.pid);
  const reopened = await (await fetch(`${restarted.url}/api/trips/${trip.id}`)).json(); assert.equal(reopened.trip.originalRequest, trip.originalRequest);
  assert.deepEqual(fingerprint(path.join(target, "data/serendipity.db")), before); assert.equal(readInstanceState(path.join(target, "data/serendipity.db")).dataGeneration, generation);
  record("stop, repeated stop, restart retain all tables and data generation", { tripId: trip.id });
  assert.equal((await run("stop")).ok, true);
  blocker = http.createServer((request, response) => response.end("foreign-port-owner"));
  await new Promise((resolve, reject) => { blocker.once("error", reject); blocker.listen(3140, "127.0.0.1", resolve); });
  const conflict = await run("start"); assert.equal(conflict.ok, true); assert.equal(conflict.port, 3141);
  assert.equal(await (await fetch("http://127.0.0.1:3140")).text(), "foreign-port-owner");
  assert.equal((await run("start")).pid, conflict.pid);
  record("occupied port uses correct alternate URL without touching foreign listener", { url: conflict.url });
  assert.equal((await run("stop")).ok, true);
  assert.equal(await (await fetch("http://127.0.0.1:3140")).text(), "foreign-port-owner");
  await new Promise((resolve) => blocker.close(resolve)); blocker = null;
  // Mimic stale on-disk state after power loss, with an actually exited worker.
  const deadPid = await new Promise((resolve) => { const child = spawn(process.execPath, ["-e", ""], { windowsHide: true }); child.once("exit", () => resolve(child.pid)); });
  fs.writeFileSync(path.join(target, "runtime/service.json"), JSON.stringify({ ...state, pid: deadPid }));
  const stale = await run("start"); assert.equal(stale.ok, true); assert.notEqual(stale.instanceId, state.instanceId);
  assert.deepEqual(fingerprint(path.join(target, "data/serendipity.db")), before);
  record("fresh process recovers stale state with unchanged data (reboot simulation)");
  // Actual abrupt service death releases OS-owned locks; no child Next remains.
  process.kill(stale.pid);
  for (let i = 0; i < 100; i++) { try { process.kill(stale.pid, 0); await delay(50); } catch { break; } }
  const crashed = await run("start"); assert.equal(crashed.ok, true); assert.notEqual(crashed.pid, stale.pid);
  assert.deepEqual(fingerprint(path.join(target, "data/serendipity.db")), before);
  record("actual service process termination and cold restart preserve data");
  assert.equal((await run("stop")).ok, true);
  const missingConfig = path.join(output, "missing-build.json"); fs.writeFileSync(missingConfig, JSON.stringify({ ...config, buildDirectory: ".next-missing-phase29" }));
  const missing = await run("start", missingConfig); assert.equal(missing.ok, false); assert.match(missing.message, /生产版本缺失/);
  record("missing release gives actionable failure without creating a new database");
  // Corrupt only an isolated DB to exercise actual migration/startup failure.
  const damaged = assertTestDataPath(path.resolve("test-data/phase29-damaged")); fs.mkdirSync(path.join(damaged, "data"), { recursive: true });
  fs.writeFileSync(path.join(damaged, "data/serendipity.db"), "synthetic invalid database");
  const damagedConfig = path.join(output, "damaged.json"); fs.writeFileSync(damagedConfig, JSON.stringify({ ...config, dataDirectory: damaged }));
  const failure = await run("start", damagedConfig); assert.equal(failure.ok, false); assert.match(failure.message, /数据检查或升级未完成/);
  assert.equal(fs.readFileSync(path.join(damaged, "data/serendipity.db"), "utf8"), "synthetic invalid database");
  record("failed database startup leaves failed data in place and reports recovery guidance");
  const absentConfig = path.join(output, "missing-database.json");
  fs.writeFileSync(absentConfig, JSON.stringify({ ...config, dataDirectory: assertTestDataPath(path.resolve("test-data/phase29-absent")), databaseRequired: true }));
  const absent = await run("start", absentConfig); assert.equal(absent.ok, false); assert.match(absent.message, /原旅行数据库找不到/);
  assert.equal(fs.existsSync(path.resolve("test-data/phase29-absent/data/serendipity.db")), false);
  record("missing original database refuses to silently create an empty replacement");
  assert.deepEqual(fingerprint(formal), protectedBefore); assert.equal(createHash("sha256").update(fs.readFileSync(keyFile)).digest("hex"), keyHashBefore);
  record("formal database all-table and security material fingerprints unchanged");
} finally {
  await run("stop");
  if (blocker) await new Promise((resolve) => blocker.close(resolve));
  fs.writeFileSync(path.join(output, "launcher-results.json"), JSON.stringify({ checkedAt: new Date().toISOString(), evidence }, null, 2));
}
