import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { acquireLock, saveJson } from "./desktop-runtime.mjs";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const metadataName = "desktop-build.json";
const sourceDirectories = new Set(["app", "lib", "scripts", "prisma", "public", "types", "src"]);
const excludedDirectories = new Set(["node_modules", "tests", "__tests__", "docs", "data", "logs", "test-data", "test-results", ".git"]);
const rootInputs = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|\.npmrc|\.nvmrc|\.node-version|\.env(?:\..*)?|(?:next|postcss|tailwind|babel|eslint)\.config\.[^/]+|\.babelrc(?:\.[^/]+)?|tsconfig(?:\.[^/]+)?\.json|jsconfig\.json|(?:proxy|middleware|instrumentation|instrumentation-client)\.[cm]?[jt]sx?)$/;
const compileEnvironmentKeys = ["NODE_ENV", "NODE_PATH", "BROWSERSLIST", "BROWSERSLIST_ENV", "TZ", "NEXT_RUNTIME", "NEXT_MINIMAL", "NEXT_DISABLE_SWC_WASM", "NEXT_DISABLE_SWC_NATIVE", "NEXT_SWC_PATH"];
// These tools run separately; none is part of the application or its launcher.
// Unknown scripts remain inputs so new runtime workers are not silently missed.
const auxiliaryScript = /^scripts\/(?:windows\/|(?:capture-|verify-|collect-phase|create-phase|profile-|probe-|measure-|prepare-gallery-additions\.|repair-evening-returns\.|export-for-review\.|export-review-core\.|final-acceptance\.|clean-test-data\.|run-isolated-tests\.|start-test-server\.|retired-verification\.))/;
const generatedTypes = /^(?:\.\/)?\.next(?:-[^/]+)?\/(?:dev\/)?types(?:\/|$)/;

function readTsconfig(filename) {
  const parsed = require("typescript").parseConfigFileTextToJson(filename, fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, ""));
  if (parsed.error) throw new Error(`TypeScript 配置无法解析：${path.basename(filename)}`);
  return parsed.config;
}

function reservedEnvironmentKey(key) {
  const upper = key.toUpperCase();
  return upper.startsWith("SERENDIPITY_") || ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL", "NODE_OPTIONS", "NEXT_MANUAL_SIG_HANDLE", "PORT"].includes(upper);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}

function inputContents(filename, relativePath) {
  const contents = fs.readFileSync(filename);
  if (relativePath === "package.json") {
    const manifest = JSON.parse(contents.toString("utf8").replace(/^\uFEFF/, ""));
    // The desktop controller invokes Next directly. Adding an npm shortcut for
    // a review/export tool does not change this production application.
    delete manifest.scripts;
    return Buffer.from(JSON.stringify(canonicalJson(manifest)));
  }
  if (!/^tsconfig(?:\.[^/]+)?\.json$/.test(relativePath)) return contents;
  // Next adds the selected distDir to include on every build. Formatting and
  // generated includes are not source changes; real compiler options still are.
  const config = readTsconfig(filename);
  if (Array.isArray(config.include)) config.include = config.include.filter((entry) =>
    typeof entry !== "string" || !generatedTypes.test(entry.replaceAll("\\", "/")));
  return Buffer.from(JSON.stringify(canonicalJson(config)));
}

function sourceSnapshot(config, nodeVersion, env) {
  const root = fs.realpathSync(config.projectRoot);
  const files = [];
  function visit(filename, relativePath, ancestors = new Set()) {
    if (auxiliaryScript.test(relativePath) || /\.(?:test|spec)\.[^/]+$/.test(relativePath)) return;
    const actual = fs.realpathSync(filename);
    const relative = path.relative(root, actual);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw new Error(`构建源码链接超出了项目目录：${relativePath}`);
    }
    const stat = fs.statSync(filename);
    if (stat.isDirectory()) {
      if (ancestors.has(actual)) throw new Error(`构建源码目录存在循环链接：${relativePath}`);
      const nextAncestors = new Set([...ancestors, actual]);
      for (const entry of fs.readdirSync(filename).sort()) {
        if (excludedDirectories.has(entry) || entry.startsWith(".next") || entry === "next-env.d.ts" || entry.endsWith(".log") || entry.endsWith(".tsbuildinfo")) continue;
        visit(path.join(filename, entry), `${relativePath}/${entry}`, nextAncestors);
      }
    } else if (stat.isFile()) files.push([relativePath, filename]);
  }
  for (const entry of fs.readdirSync(root).sort()) {
    if (sourceDirectories.has(entry) || rootInputs.test(entry)) visit(path.join(root, entry), entry);
  }
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ format: 3, nodeVersion }));
  const inputs = {};
  const environmentKeys = new Set([...compileEnvironmentKeys, ...Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_"))]);
  for (const [relativePath, filename] of files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const contents = inputContents(filename, relativePath);
    inputs[relativePath] = createHash("sha256").update(contents).digest("hex");
    hash.update(JSON.stringify([relativePath, contents.length]));
    hash.update(contents);
    // Shell session variables must not invalidate a desktop build. Also track
    // custom env names used by application code or its root build config.
    if (/\.[cm]?[jt]sx?$/.test(relativePath) && (!relativePath.includes("/") || /^(?:app|lib|src)\//.test(relativePath))) {
      const reference = /process\s*\.\s*env\s*(?:\.\s*([\w$]+)|\[\s*["']([^"']+)["']\s*\])/g;
      for (const match of contents.toString("utf8").matchAll(reference)) {
        const key = match[1] ?? match[2];
        if (!reservedEnvironmentKey(key)) environmentKeys.add(key);
      }
    }
  }
  const environment = Object.fromEntries([...environmentKeys].sort().map((key) => [key, env[key] ?? null]));
  hash.update(JSON.stringify(environment));
  for (const [key, value] of Object.entries(environment)) inputs[`环境变量 ${key}`] = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { fingerprint: hash.digest("hex"), inputs };
}

function changedInputs(before, after) {
  return [...new Set([...Object.keys(before.inputs), ...Object.keys(after.inputs)])].filter((key) => before.inputs[key] !== after.inputs[key]).slice(0, 8).join("、");
}

function writeBuildTsconfig(config, buildDirectory) {
  const rootConfig = readTsconfig(path.join(config.projectRoot, "tsconfig.json"));
  // Keep source paths relative to the root config; only this build's generated
  // route validators are included. Next never rewrites the developer's config.
  const include = (rootConfig.include ?? ["**/*"]).filter((entry) => !generatedTypes.test(entry.replaceAll("\\", "/")))
    .map((entry) => path.isAbsolute(entry) ? entry : `../../${entry}`);
  // Next preserves cache/ while cleaning distDir at the start of a build.
  fs.mkdirSync(path.join(config.projectRoot, buildDirectory, "cache"), { recursive: true });
  saveJson(path.join(config.projectRoot, buildDirectory, "cache/tsconfig.json"), {
    extends: "../../tsconfig.json", include: [...include, "../types/**/*.ts"],
  });
}

function seedCompileCache(config, buildDirectory, candidates, nodeVersion, log, completedDirectory) {
  for (const directory of new Set(candidates)) {
    if (directory === buildDirectory || !/^\.next-[a-z0-9-]+$/.test(directory)) continue;
    const source = path.join(config.projectRoot, directory);
    try {
      if (directory !== completedDirectory) {
        const metadata = JSON.parse(fs.readFileSync(path.join(source, metadataName), "utf8"));
        if (metadata.nodeVersion !== nodeVersion || !verifiedBuild(config, directory, metadata.fingerprint, nodeVersion)) continue;
      }
      fs.mkdirSync(path.join(config.projectRoot, buildDirectory, "cache"), { recursive: true });
      const copied = [];
      // Never inherit runtime/fetch caches, server bundles or business data.
      // .rscinfo keeps Next's compilation salt stable, otherwise webpack would
      // invalidate its server cache even when the application barely changed.
      for (const name of ["webpack", "swc", ".tsbuildinfo", ".rscinfo"]) {
        const from = path.join(source, "cache", name);
        if (!fs.existsSync(from) || fs.lstatSync(from).isSymbolicLink()) continue;
        fs.cpSync(from, path.join(config.projectRoot, buildDirectory, "cache", name), {
          recursive: true, filter: (filename) => !fs.lstatSync(filename).isSymbolicLink(),
        });
        copied.push(name);
      }
      if (copied.length) {
        fs.writeSync(log, `[${new Date().toISOString()}] Reused compile cache from ${directory}: ${copied.join(", ")}\n`);
        return true;
      }
    } catch (error) {
      // Cache is optional: a missing or unreadable cache must allow a cold build.
      if (error.code !== "ENOENT") fs.writeSync(log, `[${new Date().toISOString()}] Compile cache unavailable (${error.code ?? "invalid metadata"}); continuing\n`);
    }
  }
  return false;
}

function buildEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (reservedEnvironmentKey(key)) delete env[key];
  }
  return { ...env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", RUST_LOG: "info" };
}

async function runtimeVersion(config, env) {
  if (fs.realpathSync(config.nodePath) === fs.realpathSync(process.execPath)) return process.version;
  const { stdout } = await execFileAsync(config.nodePath, ["--version"], { cwd: config.projectRoot, env, windowsHide: true, timeout: 10_000, maxBuffer: 1024 });
  const version = stdout.trim();
  if (!/^v\d+\.\d+\.\d+(?:[-+].*)?$/.test(version)) throw new Error("配置的 Node.js 版本无法确认。");
  return version;
}

function verifiedBuild(config, directory, fingerprint, nodeVersion) {
  if (typeof directory !== "string" || !/^\.next-[a-z0-9-]+$/.test(directory)) return false;
  const buildPath = path.join(config.projectRoot, directory);
  try {
    if (!fs.lstatSync(buildPath).isDirectory()) return false;
    const metadata = JSON.parse(fs.readFileSync(path.join(buildPath, metadataName), "utf8"));
    const buildId = fs.readFileSync(path.join(buildPath, "BUILD_ID"), "utf8").trim();
    return Boolean(buildId) && metadata.version === 1 && metadata.fingerprint === fingerprint && metadata.nodeVersion === nodeVersion && metadata.buildId === buildId;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code) || error instanceof SyntaxError) return false;
    throw error;
  }
}

function rememberBuildUse(config, directory, configFile) {
  const filename = path.join(config.projectRoot, directory, metadataName);
  let metadata;
  try { metadata = JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return; throw error; }
  if (!verifiedBuild(config, directory, metadata.fingerprint, metadata.nodeVersion)) return;
  const owners = new Set((Array.isArray(metadata.owners) ? metadata.owners : []).filter((owner) => typeof owner === "string" && path.isAbsolute(owner)));
  if (configFile && path.isAbsolute(configFile)) owners.add(configFile);
  saveJson(filename, { ...metadata, lastUsedAt: new Date().toISOString(), owners: [...owners] });
}

async function executeBuild(request) {
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: request.env, windowsHide: request.windowsHide, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  let stage;
  const capture = (chunk) => {
    fs.writeSync(request.stdio[1], chunk);
    tail = (tail + chunk.toString("utf8")).slice(-4000);
    const phases = [
      [/Creating an optimized production build/, "正在编译新版"],
      [/Compiled successfully|Running TypeScript/, "正在检查 TypeScript 类型"],
      [/Finished TypeScript|Collecting page data|Generating static pages/, "正在生成页面"],
      [/Finalizing page optimization|Collecting build traces/, "正在整理生产文件"],
    ];
    const current = phases.findLast(([pattern]) => pattern.test(tail))?.[1];
    if (current && current !== stage) { stage = current; request.onProgress?.(current); }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`自动构建失败（${signal ? `信号 ${signal}` : `退出码 ${code}`}）。`)));
  });
}

function projectBuildLock(config, timeout) {
  // acquireLock hashes dataDirectory. Substitute the canonical project here so
  // shortcuts using different business-data roots cannot build it concurrently.
  return acquireLock({ ...config, dataDirectory: config.projectRoot }, "build", timeout);
}

export async function prepareDesktopBuild(config, options = {}) {
  if (config.autoBuild !== true) return { config, changed: false, fingerprint: "" };
  const runtimeDirectory = config.runtimeDirectory ?? path.join(config.dataDirectory, "runtime");
  const buildConfig = { ...config, runtimeDirectory };
  fs.mkdirSync(runtimeDirectory, { recursive: true });
  const logPath = path.join(runtimeDirectory, "build.log");
  let release;
  let log;
  let guardDirectory;
  try {
    options.onProgress?.("正在等待更新检查");
    release = await (options.acquireBuildLock ?? projectBuildLock)(buildConfig, options.lockTimeoutMs ?? 15 * 60_000);
    options.onProgress?.("正在检查源码是否有更新");
    let env = buildEnvironment();
    const nodeVersion = await runtimeVersion(config, env);
    rememberBuildUse(config, config.buildDirectory, options.configFile);
    let snapshot = sourceSnapshot(config, nodeVersion, env);
    const candidates = [config.buildDirectory, ...fs.readdirSync(config.projectRoot).filter((name) => /^\.next-auto-[a-z0-9-]+$/.test(name)).sort()];
    for (const directory of new Set(candidates)) {
      if (verifiedBuild(config, directory, snapshot.fingerprint, nodeVersion)) {
        rememberBuildUse(config, directory, options.configFile);
        options.onProgress?.("源码没有变化，直接使用已验证版本");
        return { config: { ...config, buildDirectory: directory }, changed: config.buildDirectory !== directory, fingerprint: snapshot.fingerprint };
      }
    }

    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
      fs.copyFileSync(logPath, `${logPath}.previous`);
      fs.truncateSync(logPath, 0);
    }
    log = fs.openSync(logPath, "a");
    guardDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "serendipity-build-"));
    const guard = path.join(guardDirectory, "no-business-data");
    // A file cannot contain a database directory. Accidental data access during
    // static generation fails, including when .env declares a business DB URL.
    fs.writeFileSync(guard, "Builds do not use travel data.", { flag: "wx", mode: 0o600 });
    const databasePath = path.join(guard, "data", "serendipity.db");
    let completedDirectory;
    let coldRetryUsed = false;
    async function compile(fingerprint, sourceAttempt) {
      while (true) {
        const buildDirectory = `.next-auto-${fingerprint.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
        const buildPath = path.join(config.projectRoot, buildDirectory);
        // Reserve a new directory. A failed build never edits an older artifact.
        fs.mkdirSync(buildPath);
        saveJson(path.join(buildPath, "desktop-build-pending.json"), { version: 1, projectRoot: fs.realpathSync(config.projectRoot), createdAt: new Date().toISOString() });
        const started = Date.now();
        fs.writeSync(log, `\n[${new Date().toISOString()}] Building ${buildDirectory} (source attempt ${sourceAttempt + 1}/2${coldRetryUsed ? ", cold cache retry" : ""})\n`);
        options.onProgress?.("正在准备编译缓存");
        const cacheReused = !coldRetryUsed && seedCompileCache(config, buildDirectory, [completedDirectory, ...candidates].filter(Boolean), nodeVersion, log, completedDirectory);
        writeBuildTsconfig(config, buildDirectory);
        options.onProgress?.(cacheReused ? "已复用编译缓存，正在构建新版" : "首次构建此版本，正在编译新版");
        try {
          await (options.executor ?? executeBuild)({
            command: config.nodePath,
            args: [path.join(config.projectRoot, "node_modules/next/dist/bin/next"), "build", "--webpack"],
            cwd: config.projectRoot,
            env: { ...env, SERENDIPITY_BUILD_DIR: buildDirectory, SERENDIPITY_DESKTOP_BUILD: "1", SERENDIPITY_DATA_DIR: guard, DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}` },
            windowsHide: true, stdio: ["ignore", log, log], logPath, onProgress: options.onProgress,
          });
          return { buildDirectory, buildPath, started, cacheReused };
        } catch (error) {
          if (!cacheReused || coldRetryUsed) throw error;
          // Webpack can fail while resolving snapshots copied from an older
          // distDir. Retry once without any inherited compiler state, in a new
          // artifact. Keep the failed output and the serving version untouched.
          fs.writeSync(log, `[${new Date().toISOString()}] Cached build failed: ${error.message}; retrying once with a fresh compile cache\n`);
          coldRetryUsed = true;
          completedDirectory = undefined;
          options.onProgress?.("缓存构建未通过，正在使用全新缓存自动重试一次");
        }
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const { fingerprint } = snapshot;
      const { buildDirectory, buildPath, started, cacheReused } = await compile(fingerprint, attempt);
      let buildId;
      try { buildId = fs.readFileSync(path.join(buildPath, "BUILD_ID"), "utf8").trim(); }
      catch (error) { throw new Error("自动构建未生成可用的 BUILD_ID。", { cause: error }); }
      if (!buildId) throw new Error("自动构建生成的 BUILD_ID 为空。");
      options.onProgress?.("正在核对新版文件");
      env = buildEnvironment();
      const after = sourceSnapshot(config, nodeVersion, env);
      if (after.fingerprint !== fingerprint) {
        const changes = changedInputs(snapshot, after);
        fs.writeSync(log, `[${new Date().toISOString()}] Build inputs changed: ${changes}\n`);
        if (attempt === 1) throw new Error(`构建期间文件持续变化，自动重试后仍未稳定：${changes}。本次产物未启用，请保存修改后重新启动。`);
        options.onProgress?.("检测到构建期间保存了修改，正在自动重试一次");
        snapshot = after;
        completedDirectory = buildDirectory;
        continue;
      }
      const durationMs = Date.now() - started;
      saveJson(path.join(buildPath, metadataName), { version: 1, fingerprint, buildId, nodeVersion, builtAt: new Date().toISOString(), durationMs, cacheReused });
      rememberBuildUse(config, buildDirectory, options.configFile);
      // Next owns distDir and may already have removed this reservation marker.
      fs.rmSync(path.join(buildPath, "desktop-build-pending.json"), { force: true });
      fs.writeSync(log, `[${new Date().toISOString()}] Verified ${buildDirectory} in ${(durationMs / 1000).toFixed(1)}s (compile cache ${cacheReused ? "reused" : "cold"})\n`);
      return { config: { ...config, buildDirectory }, changed: true, fingerprint };
    }
    throw new Error("自动构建未完成。");
  } catch (error) {
    if (log !== undefined) fs.writeSync(log, `[${new Date().toISOString()}] ${error.message}\n`);
    throw new Error(`${error.message}\n构建日志：${logPath}`, { cause: error });
  } finally {
    try {
      if (log !== undefined) fs.closeSync(log);
      if (guardDirectory) {
        const guard = path.join(guardDirectory, "no-business-data");
        if (fs.existsSync(guard)) fs.unlinkSync(guard);
        fs.rmdirSync(guardDirectory);
      }
    } finally { if (release) await release(); }
  }
}
