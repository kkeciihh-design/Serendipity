import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { Buffer } from "node:buffer";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, checkFiles, choosePort, friendlyError, readConfig, readJson, saveJson, serviceEnvironment } from "./desktop-runtime.mjs";

const config = readConfig(process.argv[3]);
const stateFile = path.join(config.runtimeDirectory, "service.json");
const instanceId = randomUUID();
const token = randomBytes(32).toString("hex");
let state;
let status = "starting";
let runtimeHealth = null;
let stopping = false;

async function probe() {
  try {
    const response = await fetch(`${state.url}/api/runtime`, { signal: globalThis.AbortSignal.timeout(3000), redirect: "error" });
    const info = await response.json();
    if (response.ok && info.instanceId === instanceId && info.pid === process.pid && info.databasePath === path.join(config.dataDirectory, "data/serendipity.db")) return info;
  } catch { /* A busy or failed app must not be advertised as healthy. */ }
  return null;
}

const controlServer = http.createServer(async (request, response) => {
  const supplied = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (request.headers.host !== `127.0.0.1:${state?.controlPort}` || request.headers.origin || supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)) {
    response.writeHead(403); response.end(); return;
  }
  const reply = (value) => { response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); };
  if (request.url === "/status" && request.method === "GET") {
    if (status === "ready") runtimeHealth = await probe();
    reply({ instanceId, pid: process.pid, status: status === "ready" && !runtimeHealth ? "unhealthy" : status, url: state.url, port: state.port,
      preferredPort: config.preferredPort, startedAt: state.startedAt, buildDirectory: config.buildDirectory, restoreActive: runtimeHealth?.restoreActive ?? false });
  } else if (request.url === "/stop" && request.method === "POST") {
    reply({ instanceId, pid: process.pid, status: "stopping" });
    if (!stopping) {
      stopping = true; status = "stopping";
      // Invoke Next's graceful handler in this process; no PID-based killing.
      setTimeout(() => { controlServer.close(); process.emit("SIGTERM", "SIGTERM"); }, 100);
    }
  } else { response.writeHead(404); response.end(); }
});

process.on("exit", () => {
  try { if (readJson(stateFile)?.instanceId === instanceId) fs.unlinkSync(stateFile); } catch { /* Preserve data on cleanup failure. */ }
});

try {
  await acquireLock(config, "instance", 0);
  checkFiles(config);
  const port = await choosePort(config.preferredPort);
  await new Promise((resolve, reject) => { controlServer.once("error", reject); controlServer.listen(0, "127.0.0.1", resolve); });
  state = { version: 1, instanceId, token, pid: process.pid, port, url: `http://127.0.0.1:${port}`, controlPort: controlServer.address().port,
    startedAt: new Date().toISOString(), projectRoot: config.projectRoot, dataDirectory: config.dataDirectory, buildDirectory: config.buildDirectory };
  saveJson(stateFile, state);
  Object.assign(process.env, serviceEnvironment(config, { SERENDIPITY_LOCAL_PORT: String(port), SERENDIPITY_INSTANCE_ID: instanceId,
    SERENDIPITY_STARTED_AT: state.startedAt }));
  process.chdir(config.projectRoot);
  const migrationCode = await new Promise((resolve, reject) => {
    const migration = spawn(config.nodePath, [path.join(config.projectRoot, "scripts/ensure-database.mjs")], { env: process.env, stdio: "inherit", windowsHide: true });
    migration.once("error", reject); migration.once("exit", resolve);
  });
  if (migrationCode !== 0) throw new Error("数据检查或升级未完成。请让维护者查看日志并修复后重试；不会创建替代数据库。");
  const { startServer } = await import("next/dist/server/lib/start-server.js");
  await startServer({ dir: config.projectRoot, port, hostname: "127.0.0.1", isDev: false, allowRetry: false });
  for (let i = 0; i < 60; i++) {
    runtimeHealth = await probe();
    if (runtimeHealth) break;
    await delay(300);
  }
  if (!runtimeHealth) throw new Error("网页健康检查未通过，未打开浏览器。请让维护者查看运行日志。");
  saveJson(path.join(config.runtimeDirectory, "initialized.json"), { databasePath: runtimeHealth.databasePath });
  status = "ready";
  console.log(`Serendipity ready at ${state.url}; data: ${config.dataDirectory}`);
} catch (error) {
  status = "failed";
  saveJson(path.join(config.runtimeDirectory, "last-error.json"), { pid: process.pid, time: new Date().toISOString(), message: friendlyError(error) });
  console.error(friendlyError(error));
  process.exit(1);
}
