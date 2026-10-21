import fs from "node:fs";
import { promises as files } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acquireLock, saveJson } from "./desktop-runtime.mjs";

const execute = promisify(execFile);
const managedName = /^\.next-auto-[a-f0-9]{12}-[a-f0-9]{8}$/;
const artifactName = /^\.next-[a-z0-9-]+$/;

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code) || error instanceof SyntaxError) return null;
    throw error;
  }
}

function samePath(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// Every recursive removal is preceded by this check, including a fresh check
// after planning. Junctions and paths outside this exact project are rejected.
function safeDirectory(root, name) {
  if (!artifactName.test(name)) return null;
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) return null;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync(target), target)) return null;
    return { target, stat };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function inspectArtifact(root, name, previouslyFailed) {
  const safe = safeDirectory(root, name);
  if (!safe) return null;
  const metadata = readJson(path.join(safe.target, "desktop-build.json"));
  let buildId;
  try { buildId = fs.readFileSync(path.join(safe.target, "BUILD_ID"), "utf8").trim(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const verified = Boolean(buildId) && metadata?.version === 1 && metadata.buildId === buildId && /^[a-f0-9]{64}$/.test(metadata.fingerprint ?? "");
  const required = readJson(path.join(safe.target, "required-server-files.json"));
  const pending = readJson(path.join(safe.target, "desktop-build-pending.json"));
  // A matching name alone is insufficient evidence to remove an arbitrary
  // directory. Accept Next's manifest, our build marker, or a prior failed rm.
  if (!verified && required?.config?.distDir !== name && !(pending?.version === 1 && samePath(pending.projectRoot ?? "", root)) && !previouslyFailed.has(name)) return null;
  return {
    name, verified, metadata,
    time: Date.parse(metadata?.lastUsedAt ?? metadata?.builtAt ?? pending?.createdAt) || safe.stat.mtimeMs,
    builtAt: Date.parse(metadata?.builtAt) || safe.stat.mtimeMs,
    locked: fs.existsSync(path.join(safe.target, "lock")) || fs.existsSync(path.join(safe.target, "dev/lock")),
  };
}

async function activeLauncherConfigs() {
  if (process.platform !== "win32") return [];
  // Discover services started by older launchers, whose build metadata does not
  // yet record its config owners. Do not log process command lines or tokens.
  const { stdout } = await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "@(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -match 'desktop-service\\.mjs' } | Select-Object -ExpandProperty CommandLine) | ConvertTo-Json -Compress"],
  { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
  const commands = stdout.trim() ? JSON.parse(stdout.replace(/^\uFEFF/, "")) : [];
  return (Array.isArray(commands) ? commands : [commands]).flatMap((command) => {
    const match = command.match(/--config\s+(?:"([^"]+)"|(\S+))/);
    return match ? [match[1] ?? match[2]] : [];
  });
}

function directoryBytes(directory) {
  let size = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) size += directoryBytes(filename);
    else if (entry.isFile()) size += fs.statSync(filename).size;
  }
  return size;
}

/** Keep the current release, two rollback releases and one failed build. */
export async function pruneDesktopBuilds(config, options = {}) {
  const root = fs.realpathSync(config.projectRoot);
  const runtime = config.runtimeDirectory ?? path.join(config.dataDirectory, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const reportFile = path.join(runtime, "build-cleanup.json");
  const report = { removed: [], retained: [], failed: [], reclaimedBytes: 0, skipped: false };
  let release;
  try {
    // A busy compiler takes priority over housekeeping. The next launch retries.
    try {
      release = await (options.acquireBuildLock ?? ((selected) => acquireLock({ ...selected, dataDirectory: root }, "build", 0)))({ ...config, runtimeDirectory: runtime });
    } catch {
      return { ...report, skipped: true, reason: "另一项构建正在进行，稍后自动清理" };
    }
    const previous = readJson(reportFile);
    const previouslyFailed = new Set((previous?.failed ?? []).map((item) => item.directory).filter((name) => managedName.test(name)));
    const extra = new Set((options.extraDirectories ?? []).filter((name) => artifactName.test(name)));
    const names = fs.readdirSync(root).filter((name) => managedName.test(name) || extra.has(name));
    const artifacts = names.map((name) => inspectArtifact(root, name, previouslyFailed)).filter(Boolean);
    const protectedNames = new Set([config.buildDirectory, ...(options.protectedDirectories ?? [])]);

    function protectConfig(filename, fallback) {
      try {
        const owner = readJson(filename);
        if (!owner || !samePath(fs.realpathSync(owner.projectRoot), root)) {
          if (fallback) protectedNames.add(fallback);
          return;
        }
        if (artifactName.test(owner.buildDirectory)) protectedNames.add(owner.buildDirectory);
        const state = readJson(path.join(owner.dataDirectory, "runtime/service.json"));
        if (state && samePath(state.projectRoot ?? "", root) && artifactName.test(state.buildDirectory)) protectedNames.add(state.buildDirectory);
      } catch { if (fallback) protectedNames.add(fallback); }
    }

    // If legacy service discovery fails, skip deletion instead of guessing which
    // instance is active. Future runs retry without affecting the ready app.
    let activeConfigs;
    try { activeConfigs = await (options.listActiveConfigFiles ?? activeLauncherConfigs)(); }
    catch { return { ...report, skipped: true, reason: "暂时无法核对运行中的版本，稍后自动清理" }; }
    for (const filename of activeConfigs) protectConfig(filename);
    for (const artifact of artifacts) {
      if (artifact.locked) protectedNames.add(artifact.name);
      for (const filename of Array.isArray(artifact.metadata?.owners) ? artifact.metadata.owners : []) {
        if (typeof filename === "string" && path.isAbsolute(filename)) protectConfig(filename, artifact.name);
      }
    }
    // Standalone typecheck/editor references must remain valid after pruning.
    let declarations = "";
    try { declarations = fs.readFileSync(path.join(root, "next-env.d.ts"), "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const match of declarations.matchAll(/["']\.\/(\.next-[a-z0-9-]+)\/(?:dev\/)?types\//g)) protectedNames.add(match[1]);

    const byRecent = (a, b) => b.time - a.time || a.name.localeCompare(b.name);
    const verified = artifacts.filter((item) => item.verified && !protectedNames.has(item.name)).sort(byRecent);
    const alreadyProtected = artifacts.filter((item) => item.verified && protectedNames.has(item.name)).length;
    for (const artifact of verified.slice(0, Math.max(0, 3 - alreadyProtected))) protectedNames.add(artifact.name);
    const failed = artifacts.filter((item) => !item.verified && managedName.test(item.name) && !previouslyFailed.has(item.name)).sort(byRecent);
    if (failed[0]) protectedNames.add(failed[0].name);
    // A build can be prepared by another data directory just before it selects
    // and starts that artifact. Allow a short handoff interval under this lock.
    const now = options.now ?? Date.now();
    for (const artifact of artifacts) {
      if (artifact.verified && now - artifact.builtAt < (options.minimumAgeMs ?? 5 * 60_000)) protectedNames.add(artifact.name);
    }
    const obsolete = artifacts.filter((item) => !protectedNames.has(item.name));
    report.retained = artifacts.filter((item) => protectedNames.has(item.name)).map((item) => item.name);
    for (const [index, artifact] of obsolete.entries()) {
      options.onProgress?.(`正在清理过期构建 ${index + 1}/${obsolete.length}`);
      try {
        const safe = safeDirectory(root, artifact.name);
        if (!safe) throw new Error("目录已变化，保留待下次核对");
        const bytes = directoryBytes(safe.target);
        // Recheck the resolved absolute target immediately before recursive rm.
        const checked = safeDirectory(root, artifact.name);
        if (!checked || checked.stat.ino !== safe.stat.ino) throw new Error("目录已变化，保留待下次核对");
        if (!options.dryRun) await files.rm(checked.target, { recursive: true, maxRetries: 1, retryDelay: 100 });
        report.removed.push({ directory: artifact.name, bytes });
        report.reclaimedBytes += bytes;
      } catch (error) {
        report.failed.push({ directory: artifact.name, reason: error.code ?? error.message });
      }
    }
    if (!options.dryRun) saveJson(reportFile, { ...report, cleanedAt: new Date(now).toISOString() });
    return report;
  } finally { if (release) await release(); }
}
