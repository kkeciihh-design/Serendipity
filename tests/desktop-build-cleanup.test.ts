import fs, { promises as files } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pruneDesktopBuilds, type BuildCleanupOptions } from "../scripts/desktop-build-cleanup.mjs";

const temporaryRoots: string[] = [];
const now = Date.parse("2026-10-20T12:00:00Z");
const noLock = async () => async () => {};
const options: BuildCleanupOptions = { acquireBuildLock: noLock, listActiveConfigFiles: async () => [], now };
const name = (index: number) => `.next-auto-${index.toString(16).padStart(12, "0")}-${index.toString(16).padStart(8, "0")}`;

function write(root: string, relative: string, value: string) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, value);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serendipity-cleanup-test-"));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, "project");
  const dataDirectory = path.join(root, "travel-data");
  fs.mkdirSync(projectRoot);
  write(dataDirectory, "data/serendipity.db", "original travel data");
  return { projectRoot, dataDirectory, runtimeDirectory: path.join(dataDirectory, "runtime"), nodePath: process.execPath, buildDirectory: name(1), autoBuild: true };
}

function artifact(root: string, index: number, usedMinutesAgo: number, extra: Record<string, unknown> = {}) {
  const directory = name(index);
  write(root, `${directory}/BUILD_ID`, `build-${index}`);
  write(root, `${directory}/server/app.js`, "production output");
  write(root, `${directory}/desktop-build.json`, JSON.stringify({ version: 1, fingerprint: index.toString(16).padStart(64, "0"), nodeVersion: process.version, buildId: `build-${index}`, builtAt: new Date(now - usedMinutesAgo * 60_000).toISOString(), ...extra }));
  return directory;
}

function failedArtifact(root: string, index: number, minutesAgo: number) {
  const directory = name(index);
  write(root, `${directory}/desktop-build-pending.json`, JSON.stringify({ version: 1, projectRoot: fs.realpathSync(root), createdAt: new Date(now - minutesAgo * 60_000).toISOString() }));
  return directory;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("serendipity-cleanup-test-")) throw new Error("Unexpected cleanup fixture root");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("desktop build retention", () => {
  it("retains the current release, two recent rollback releases and the latest failed build", async () => {
    const config = fixture();
    for (let index = 1; index <= 7; index++) artifact(config.projectRoot, index, 100 - index);
    failedArtifact(config.projectRoot, 8, 30);
    failedArtifact(config.projectRoot, 9, 20);
    write(config.projectRoot, ".next/server/app.js", "manual running build");
    write(config.projectRoot, ".next-auto-visual2/dev/lock", "development service");
    write(config.projectRoot, `${name(10)}/personal-notes.txt`, "unrecognized directory must survive");
    const result = await pruneDesktopBuilds(config, options);
    expect(result.retained.sort()).toEqual([name(1), name(6), name(7), name(9)].sort());
    expect(result.removed.map((item) => item.directory).sort()).toEqual([2, 3, 4, 5, 8].map(name).sort());
    expect(result.reclaimedBytes).toBeGreaterThan(0);
    expect(result.failed).toEqual([]);
    expect(fs.existsSync(path.join(config.projectRoot, ".next/server/app.js"))).toBe(true);
    expect(fs.existsSync(path.join(config.projectRoot, ".next-auto-visual2/dev/lock"))).toBe(true);
    expect(fs.existsSync(path.join(config.projectRoot, name(10), "personal-notes.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(config.dataDirectory, "data/serendipity.db"), "utf8")).toBe("original travel data");
  });

  it("skips housekeeping while another build holds the project lock", async () => {
    const config = fixture();
    artifact(config.projectRoot, 1, 100);
    const listActiveConfigFiles = vi.fn(async () => []);
    const result = await pruneDesktopBuilds(config, { ...options, listActiveConfigFiles, acquireBuildLock: async () => { throw new Error("busy"); } });
    expect(result.skipped).toBe(true);
    expect(listActiveConfigFiles).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(config.projectRoot, name(1)))).toBe(true);
  });

  it("protects other launcher selections and their running services using recorded owners or legacy discovery", async () => {
    const config = fixture();
    const otherFile = path.join(config.dataDirectory, "other-launcher.json");
    const legacyFile = path.join(config.dataDirectory, "legacy-launcher.json");
    for (let index = 1; index <= 7; index++) artifact(config.projectRoot, index, 100 - index, index === 2 ? { owners: [otherFile] } : {});
    fs.writeFileSync(otherFile, JSON.stringify({ projectRoot: config.projectRoot, dataDirectory: path.join(config.dataDirectory, "other"), buildDirectory: name(2) }));
    fs.writeFileSync(legacyFile, JSON.stringify({ projectRoot: config.projectRoot, dataDirectory: path.join(config.dataDirectory, "legacy"), buildDirectory: name(3) }));
    write(config.dataDirectory, "legacy/runtime/service.json", JSON.stringify({ projectRoot: config.projectRoot, buildDirectory: name(4) }));
    const result = await pruneDesktopBuilds(config, { ...options, listActiveConfigFiles: async () => [legacyFile] });
    for (const index of [1, 2, 3, 4]) expect(result.retained).toContain(name(index));
    expect(result.removed.map((item) => item.directory)).toEqual([5, 6, 7].map(name));
  });

  it("preserves generated type references, locks and explicit running builds", async () => {
    const config = fixture();
    for (let index = 1; index <= 8; index++) artifact(config.projectRoot, index, 100 - index);
    write(config.projectRoot, "next-env.d.ts", `import './${name(2)}/types/routes.d.ts';`);
    write(config.projectRoot, `${name(3)}/dev/lock`, "active development");
    write(config.projectRoot, `${name(4)}/lock`, "active compiler");
    const result = await pruneDesktopBuilds(config, { ...options, protectedDirectories: [name(5)] });
    for (const index of [1, 2, 3, 4, 5]) expect(result.retained).toContain(name(index));
    expect(result.removed.map((item) => item.directory)).toEqual([6, 7, 8].map(name));
  });

  it("allows a recently prepared release time to be selected by another launcher", async () => {
    const config = fixture();
    artifact(config.projectRoot, 1, 100);
    artifact(config.projectRoot, 2, 10);
    artifact(config.projectRoot, 3, 20);
    artifact(config.projectRoot, 4, 1, { lastUsedAt: new Date(now - 30 * 60_000).toISOString() });
    const recent = await pruneDesktopBuilds(config, options);
    expect(recent.retained).toContain(name(4));
    const later = await pruneDesktopBuilds(config, { ...options, now: now + 6 * 60_000 });
    expect(later.removed.map((item) => item.directory)).toEqual([name(4)]);
  });

  it("rejects junctions and resolved targets outside the project before recursive removal", async () => {
    const config = fixture();
    const outside = path.join(config.dataDirectory, "outside");
    write(outside, "keep.txt", "must survive recursive removal");
    for (let index = 1; index <= 6; index++) artifact(config.projectRoot, index, 100 - index);
    const lstat = fs.lstatSync.bind(fs);
    const realpath = fs.realpathSync.bind(fs);
    // Exercise both guards without requiring Windows reparse-point privileges.
    vi.spyOn(fs, "lstatSync").mockImplementation(((filename: fs.PathLike) => {
      const stat = lstat(filename);
      if (filename === path.join(config.projectRoot, name(2))) stat.isSymbolicLink = () => true;
      return stat;
    }) as typeof fs.lstatSync);
    vi.spyOn(fs, "realpathSync").mockImplementation(((filename: fs.PathLike) => filename === path.join(config.projectRoot, name(3)) ? outside : realpath(filename)) as typeof fs.realpathSync);
    const result = await pruneDesktopBuilds(config, options);
    expect(result.removed.map((item) => item.directory)).toEqual([name(4)]);
    expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe("must survive recursive removal");
    for (const index of [2, 3]) expect(fs.existsSync(path.join(config.projectRoot, name(index), "server/app.js"))).toBe(true);
  });

  it("cleans explicitly reviewed verification builds while rejecting traversal and unknown directories", async () => {
    const config = fixture();
    artifact(config.projectRoot, 1, 100);
    write(config.projectRoot, ".next-task-old/required-server-files.json", JSON.stringify({ config: { distDir: ".next-task-old" } }));
    write(config.projectRoot, ".next-custom/notes.txt", "custom work");
    const result = await pruneDesktopBuilds(config, { ...options, extraDirectories: [".next-task-old", ".next-custom", "../travel-data", config.dataDirectory, ".next"] });
    expect(result.removed.map((item) => item.directory)).toEqual([".next-task-old"]);
    expect(fs.existsSync(path.join(config.projectRoot, ".next-custom/notes.txt"))).toBe(true);
    expect(fs.existsSync(path.join(config.dataDirectory, "data/serendipity.db"))).toBe(true);
  });

  it("leaves a ready app intact if active service inventory is unavailable", async () => {
    const config = fixture();
    for (let index = 1; index <= 4; index++) artifact(config.projectRoot, index, 100 - index);
    const release = vi.fn(async () => {});
    const result = await pruneDesktopBuilds(config, { ...options, acquireBuildLock: async () => release, listActiveConfigFiles: async () => { throw new Error("inventory unavailable"); } });
    expect(result.skipped).toBe(true);
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(path.join(config.projectRoot, name(2)))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("retries a partially removed build on the next launch after a file lock failure", async () => {
    const config = fixture();
    artifact(config.projectRoot, 1, 100);
    failedArtifact(config.projectRoot, 2, 30);
    failedArtifact(config.projectRoot, 3, 20);
    vi.spyOn(files, "rm").mockRejectedValueOnce(Object.assign(new Error("in use"), { code: "EBUSY" }));
    const failed = await pruneDesktopBuilds(config, options);
    expect(failed.failed).toEqual([{ directory: name(2), reason: "EBUSY" }]);
    fs.unlinkSync(path.join(config.projectRoot, name(2), "desktop-build-pending.json"));
    const retried = await pruneDesktopBuilds(config, options);
    expect(retried.removed.map((item) => item.directory)).toEqual([name(2)]);
    expect(retried.failed).toEqual([]);
  });

  it("supports a reviewable dry run without deleting files or saving a report", async () => {
    const config = fixture();
    for (let index = 1; index <= 4; index++) artifact(config.projectRoot, index, 100 - index);
    const result = await pruneDesktopBuilds(config, { ...options, dryRun: true });
    expect(result.removed.map((item) => item.directory)).toEqual([name(2)]);
    expect(fs.existsSync(path.join(config.projectRoot, name(2)))).toBe(true);
    expect(fs.existsSync(path.join(config.runtimeDirectory, "build-cleanup.json"))).toBe(false);
  });
});
