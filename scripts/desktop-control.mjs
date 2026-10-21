import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { alive, checkFiles, control, friendlyError, readConfig, readJson, saveJson, serviceEnvironment, withOperationLock } from "./desktop-runtime.mjs";
import { prepareDesktopBuild } from "./desktop-build.mjs";
import { runDesktopStart } from "./desktop-update.mjs";
import { pruneDesktopBuilds } from "./desktop-build-cleanup.mjs";

// stdout remains one JSON result for existing callers. The Windows launcher
// consumes these optional stderr events without exposing compiler output.
const reportProgress = (message) => process.stderr.write(`SERENDIPITY_PROGRESS ${JSON.stringify({ message })}\n`);

async function stopManaged(state) {
  if (!await control(state, "stop")) throw new Error("停止请求没有成功，请稍后重试。");
  for (let i = 0; i < 150; i++) {
    if (!alive(state.pid)) return;
    await delay(200);
  }
  throw new Error("应用仍在结束正在进行的操作，请稍后查看运行状态。数据目录保持不变。");
}

async function startManaged(config, filename) {
  checkFiles(config);
  const logPath = path.join(config.runtimeDirectory, "service.log");
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
    fs.copyFileSync(logPath, `${logPath}.previous`);
    fs.truncateSync(logPath, 0);
  }
  const log = fs.openSync(logPath, "a");
  let child;
  try {
    child = spawn(config.nodePath, [path.join(config.projectRoot, "scripts/desktop-service.mjs"), "--config", filename], {
      cwd: config.projectRoot, env: serviceEnvironment(config), detached: true, windowsHide: true, stdio: ["ignore", log, log],
    });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  } finally { fs.closeSync(log); }
  child.unref();
  const startupError = (message) => Object.assign(new Error(message), { candidatePid: child.pid });
  const stateFile = path.join(config.runtimeDirectory, "service.json");
  for (let i = 0; i < 600; i++) {
    const state = readJson(stateFile);
    const running = state?.pid === child.pid ? await control(state) : null;
    if (running?.status === "ready") return running;
    if (running?.status === "failed" || !alive(child.pid)) {
      const failure = readJson(path.join(config.runtimeDirectory, "last-error.json"));
      throw startupError(failure?.pid === child.pid ? failure.message : "应用启动失败。请查看运行日志；旅行数据保持原位置。");
    }
    await delay(200);
  }
  throw startupError("应用还未就绪，请稍后点击运行状态；不会打开错误的网页。");
}

const [action, option, filename] = process.argv.slice(2);
try {
  if (!["start", "stop", "status"].includes(action) || option !== "--config" || !filename) throw new Error("无法识别启动操作。");
  const configFile = path.resolve(filename);
  const initialConfig = readConfig(configFile);
  const result = await withOperationLock(initialConfig, async () => {
    // Another start may have selected a new build while this request was queued.
    const config = readConfig(configFile);
    if (config.dataDirectory !== initialConfig.dataDirectory || config.projectRoot !== initialConfig.projectRoot) {
      throw new Error("启动位置在等待期间发生变化，请重新点击启动。");
    }
    const stateFile = path.join(config.runtimeDirectory, "service.json");
    const inspect = async () => {
      const state = readJson(stateFile);
      return { state, running: await control(state) };
    };
    const details = { dataDirectory: config.dataDirectory, logPath: path.join(config.runtimeDirectory, "service.log") };
    if (action === "start") {
      // Reject a missing original database before spending time on a new build.
      checkFiles(config);
      const running = await runDesktopStart(config, {
        inspect, alive, prepareBuild: (selected) => prepareDesktopBuild(selected, { onProgress: reportProgress, configFile }),
        readConfig: () => readConfig(configFile),
        saveBuild: (buildDirectory) => {
          const raw = JSON.parse(fs.readFileSync(configFile, "utf8").replace(/^\uFEFF/, ""));
          saveJson(configFile, { ...raw, buildDirectory });
        },
        stopService: (state) => { reportProgress("新版已就绪，正在切换服务"); return stopManaged(state); },
        startService: (selected) => { reportProgress("正在启动旅行助手并检查连接"); return startManaged(selected, configFile); },
      });
      let cleanup;
      // Housekeeping runs only after a healthy service is ready, under the same
      // project build lock as compilation. Failure cannot undo a good startup.
      if (config.autoBuild === true) {
        try {
          cleanup = await pruneDesktopBuilds({ ...config, buildDirectory: running.buildDirectory }, { onProgress: reportProgress, protectedDirectories: [config.buildDirectory] });
        } catch (error) {
          cleanup = { skipped: true, reason: error.message };
        }
      }
      return { ok: true, ...running, ...details, cleanup };
    }
    const { state, running } = await inspect();
    if (action === "stop") {
      if (!running) {
        if (state && alive(state.pid)) throw new Error("后台进程尚在但未响应，无法安全确认归属。请查看运行日志；没有强制停止其他进程。");
        return { ok: true, status: "stopped", message: "应用已停止，旅行数据仍保留。", ...details };
      }
      await stopManaged(state);
      return { ok: true, status: "stopped", message: "应用已停止。下次双击启动即可继续旅行。", ...details };
    }
    return { ok: true, status: running?.status ?? (state && alive(state.pid) ? "unresponsive" : "stopped"), ...running, ...details };
  }, action === "start" ? 15 * 60_000 : 150_000);
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({ ok: false, status: "error", message: friendlyError(error) }));
  process.exitCode = 1;
}
