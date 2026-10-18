import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export function readConfig(filename) {
  const config = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  if (config.version !== 1 || ![config.projectRoot, config.dataDirectory, config.nodePath].every((p) => typeof p === "string" && path.isAbsolute(p)) ||
      !/^\.next-[a-z0-9-]+$/.test(config.buildDirectory) || (config.autoBuild !== undefined && typeof config.autoBuild !== "boolean") ||
      !Number.isInteger(config.preferredPort) || config.preferredPort < 1024 || config.preferredPort > 65515) {
    throw new Error("启动配置不完整，请让维护者修复桌面入口；旅行数据没有更换。");
  }
  return { ...config, runtimeDirectory: path.join(config.dataDirectory, "runtime") };
}

export function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}

export function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function saveJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

// Windows owns these named pipes, so abrupt exit/reboot releases the locks.
// Canonical paths make different shortcuts/releases share the same lock.
export async function acquireLock(config, kind, timeout = 150_000) {
  fs.mkdirSync(config.runtimeDirectory, { recursive: true });
  if (process.platform !== "win32") throw new Error("桌面启动入口仅支持 Windows。");
  const identity = createHash("sha256").update(fs.realpathSync(config.dataDirectory).toLowerCase()).digest("hex");
  const pipe = `\\\\.\\pipe\\serendipity-${kind}-${identity}`;
  const deadline = Date.now() + timeout;
  while (true) {
    const server = net.createServer((socket) => socket.end());
    try {
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(pipe, resolve); });
      return () => new Promise((resolve) => server.close(resolve));
    } catch (error) {
      if (error.code !== "EADDRINUSE" && error.code !== "EACCES") throw error;
      if (Date.now() >= deadline) throw new Error("另一项启动或停止操作尚未完成，请稍后再点运行状态。", { cause: error });
      await delay(200);
    }
  }
}

export async function withOperationLock(config, operation, timeout = 150_000) {
  const release = await acquireLock(config, "operation", timeout);
  try { return await operation(); }
  finally { await release(); }
}

export function checkFiles(config) {
  if (!fs.existsSync(path.join(config.projectRoot, config.buildDirectory, "BUILD_ID")) ||
      !fs.existsSync(path.join(config.projectRoot, "node_modules/next/dist/server/lib/start-server.js")) || !fs.existsSync(config.nodePath)) {
    throw new Error("应用文件或生产版本缺失，请让维护者重新安装本地版本；不要删除旅行数据。");
  }
  const database = path.join(config.dataDirectory, "data/serendipity.db");
  if ((config.databaseRequired || fs.existsSync(path.join(config.runtimeDirectory, "initialized.json"))) && !fs.existsSync(database)) {
    throw new Error("原旅行数据库找不到，已停止启动以免出现空白旅行列表。请让维护者检查原数据位置或协助从备份恢复。");
  }
  for (const directory of [config.dataDirectory, path.join(config.dataDirectory, "data"), path.join(config.dataDirectory, "backups"), config.runtimeDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(directory, `.write-check-${randomUUID()}`);
    try {
      fs.writeFileSync(probe, "Serendipity", { flag: "wx" });
      if (fs.readFileSync(probe, "utf8") !== "Serendipity") throw new Error("Read-back failed");
    } finally { if (fs.existsSync(probe)) fs.unlinkSync(probe); }
  }
  if (fs.existsSync(database)) {
    const fd = fs.openSync(database, "r+");
    fs.closeSync(fd);
  }
}

export async function choosePort(preferred) {
  for (let port = preferred; port <= preferred + 20; port++) {
    const free = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", (error) => error.code === "EADDRINUSE" || error.code === "EACCES" ? resolve(false) : reject(error));
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("可用端口暂时不足。请关闭近期打开的其他应用后重试；旅行数据没有更换。");
}

export function serviceEnvironment(config, extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("SERENDIPITY_") || ["DATABASE_URL", "NODE_OPTIONS", "NEXT_MANUAL_SIG_HANDLE", "PORT"].includes(key)) delete env[key];
  return { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", RUST_LOG: "info",
    SERENDIPITY_DATA_DIR: config.dataDirectory, SERENDIPITY_BUILD_DIR: config.buildDirectory, ...extra };
}

export async function control(state, action = "status") {
  if (!state || !Number.isInteger(state.controlPort) || !/^[a-f0-9]{64}$/.test(state.token)) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/${action}`, {
      method: action === "stop" ? "POST" : "GET",
      headers: { Authorization: `Bearer ${state.token}` }, signal: globalThis.AbortSignal.timeout(4000), redirect: "error",
    });
    if (!response.ok) return null;
    const result = await response.json();
    return result.instanceId === state.instanceId && result.pid === state.pid ? result : null;
  } catch { return null; }
}

export function friendlyError(error) {
  if (["EACCES", "EPERM", "EROFS"].includes(error.code)) return "无法读写旅行数据目录。请恢复当前 Windows 用户对该目录的读写权限后重试；不会改用空白数据库。";
  if (error.code === "ENOSPC") return "磁盘空间不足。请腾出空间后重试；不要删除旅行数据库。";
  if (error.code === "ENOENT") return "应用文件或启动配置找不到。请让维护者修复入口；原旅行数据仍保留。";
  return error.message || "启动失败，请查看运行状态或联系维护者。";
}
