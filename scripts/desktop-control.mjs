import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { alive, checkFiles, control, friendlyError, readConfig, readJson, serviceEnvironment, withOperationLock } from "./desktop-runtime.mjs";

const [action, option, filename] = process.argv.slice(2);
try {
  if (!["start", "stop", "status"].includes(action) || option !== "--config" || !filename) throw new Error("无法识别启动操作。");
  const config = readConfig(path.resolve(filename));
  const result = await withOperationLock(config, async () => {
    const stateFile = path.join(config.runtimeDirectory, "service.json");
    let state = readJson(stateFile);
    let running = await control(state);
    const details = { dataDirectory: config.dataDirectory, logPath: path.join(config.runtimeDirectory, "service.log") };
    if (running && (state.dataDirectory !== config.dataDirectory || state.projectRoot !== config.projectRoot || state.buildDirectory !== config.buildDirectory)) {
      if (action !== "stop") throw new Error("该数据目录已有另一版本在运行。请先点击停止，再用当前入口启动。");
    }
    if (action === "stop") {
      if (!running) {
        if (state && alive(state.pid)) throw new Error("后台进程尚在但未响应，无法安全确认归属。请让维护者检查运行日志；没有强制停止其他进程。");
        return { ok: true, status: "stopped", message: "应用已停止，旅行数据仍保留。", ...details };
      }
      if (!await control(state, "stop")) throw new Error("停止请求没有成功，请稍后重试。");
      for (let i = 0; i < 150; i++) {
        if (!alive(state.pid)) return { ok: true, status: "stopped", message: "应用已停止。下次双击启动即可继续旅行。", ...details };
        await delay(200);
      }
      throw new Error("应用仍在结束正在进行的操作，请稍后查看运行状态。数据目录保持不变。");
    }
    if (action === "status") return { ok: true, status: running?.status ?? (state && alive(state.pid) ? "unresponsive" : "stopped"), ...running, ...details };
    if (!running) {
      if (state && alive(state.pid)) throw new Error("已有后台进程未响应。请查看运行状态并让维护者检查；不会再开第二个实例。");
      checkFiles(config);
      const logPath = details.logPath;
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
        fs.copyFileSync(logPath, `${logPath}.previous`);
        fs.truncateSync(logPath, 0);
      }
      const log = fs.openSync(logPath, "a");
      let child;
      try {
        child = spawn(config.nodePath, [path.join(config.projectRoot, "scripts/desktop-service.mjs"), "--config", path.resolve(filename)], {
          cwd: config.projectRoot, env: serviceEnvironment(config), detached: true, windowsHide: true, stdio: ["ignore", log, log],
        });
        await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      } finally { fs.closeSync(log); }
      child.unref();
      for (let i = 0; i < 600; i++) {
        state = readJson(stateFile);
        if (state?.pid === child.pid) running = await control(state);
        if (running?.status === "ready") break;
        if (running?.status === "failed" || !alive(child.pid)) {
          const failure = readJson(path.join(config.runtimeDirectory, "last-error.json"));
          throw new Error(failure?.pid === child.pid ? failure.message : "应用启动失败。请让维护者查看运行日志；旅行数据保持原位置。");
        }
        await delay(200);
      }
    }
    if (running?.status !== "ready") throw new Error("应用还未就绪，请稍后点击运行状态；不会打开错误的网页。");
    return { ok: true, ...running, ...details };
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, status: "error", message: friendlyError(error) }));
  process.exitCode = 1;
}
