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
  if (!/^tsconfig(?:\.[^/]+)?\.json$/.test(relativePath)) return contents;
  // Next adds the selected distDir to include on every build. Formatting and
  // generated includes are not source changes; real compiler options still are.
  const source = contents.toString("utf8").replace(/^\uFEFF/, "");
  let config;
  try { config = JSON.parse(source); }
  catch {
    const parsed = require("typescript").parseConfigFileTextToJson(filename, source);
    if (parsed.error) throw new Error(`TypeScript 配置无法解析：${relativePath}`);
    config = parsed.config;
  }
  if (Array.isArray(config.include)) config.include = config.include.filter((entry) =>
    typeof entry !== "string" || !/^(?:\.\/)?\.next(?:-[^/]+)?\/(?:dev\/)?types(?:\/|$)/.test(entry.replaceAll("\\", "/")));
  return Buffer.from(JSON.stringify(canonicalJson(config)));
}

function sourceFingerprint(config, nodeVersion, env) {
  const root = fs.realpathSync(config.projectRoot);
  const files = [];
  function visit(filename, relativePath, ancestors = new Set()) {
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
  hash.update(JSON.stringify({ format: 2, nodeVersion }));
  const environmentKeys = new Set([...compileEnvironmentKeys, ...Object.keys(env).filter((key) => key.startsWith("NEXT_PUBLIC_"))]);
  for (const [relativePath, filename] of files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const contents = inputContents(filename, relativePath);
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
  hash.update(JSON.stringify(Object.fromEntries([...environmentKeys].sort().map((key) => [key, env[key] ?? null]))));
  return hash.digest("hex");
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

async function executeBuild(request) {
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: request.env, windowsHide: request.windowsHide, stdio: request.stdio });
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
    release = await (options.acquireBuildLock ?? projectBuildLock)(buildConfig, options.lockTimeoutMs ?? 15 * 60_000);
    const env = buildEnvironment();
    const nodeVersion = await runtimeVersion(config, env);
    const fingerprint = sourceFingerprint(config, nodeVersion, env);
    const candidates = [config.buildDirectory, ...fs.readdirSync(config.projectRoot).filter((name) => /^\.next-auto-[a-z0-9-]+$/.test(name)).sort()];
    for (const directory of new Set(candidates)) {
      if (verifiedBuild(config, directory, fingerprint, nodeVersion)) {
        return { config: { ...config, buildDirectory: directory }, changed: config.buildDirectory !== directory, fingerprint };
      }
    }

    const buildDirectory = `.next-auto-${fingerprint.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
    const buildPath = path.join(config.projectRoot, buildDirectory);
    // Reserve a new directory. A failed build never edits an older artifact.
    fs.mkdirSync(buildPath);
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
      fs.copyFileSync(logPath, `${logPath}.previous`);
      fs.truncateSync(logPath, 0);
    }
    log = fs.openSync(logPath, "a");
    fs.writeSync(log, `\n[${new Date().toISOString()}] Building ${buildDirectory}\n`);
    guardDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "serendipity-build-"));
    const guard = path.join(guardDirectory, "no-business-data");
    // A file cannot contain a database directory. Accidental data access during
    // static generation fails, including when .env declares a business DB URL.
    fs.writeFileSync(guard, "Builds do not use travel data.", { flag: "wx", mode: 0o600 });
    const databasePath = path.join(guard, "data", "serendipity.db");
    await (options.executor ?? executeBuild)({
      command: config.nodePath,
      args: [path.join(config.projectRoot, "node_modules/next/dist/bin/next"), "build", "--webpack"],
      cwd: config.projectRoot,
      env: { ...env, SERENDIPITY_BUILD_DIR: buildDirectory, SERENDIPITY_DATA_DIR: guard, DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}` },
      windowsHide: true, stdio: ["ignore", log, log], logPath,
    });
    let buildId;
    try { buildId = fs.readFileSync(path.join(buildPath, "BUILD_ID"), "utf8").trim(); }
    catch (error) { throw new Error("自动构建未生成可用的 BUILD_ID。", { cause: error }); }
    if (!buildId) throw new Error("自动构建生成的 BUILD_ID 为空。");
    if (sourceFingerprint(config, nodeVersion, buildEnvironment()) !== fingerprint) {
      throw new Error("构建期间源码或构建环境发生了变化，本次产物未启用。请保存修改后重新双击启动。");
    }
    saveJson(path.join(buildPath, metadataName), { version: 1, fingerprint, buildId, nodeVersion, builtAt: new Date().toISOString() });
    fs.writeSync(log, `[${new Date().toISOString()}] Verified ${buildDirectory}\n`);
    return { config: { ...config, buildDirectory }, changed: true, fingerprint };
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
