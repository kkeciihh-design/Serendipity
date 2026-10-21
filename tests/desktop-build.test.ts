import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { prepareDesktopBuild, type DesktopBuildConfig, type DesktopBuildRequest } from "../scripts/desktop-build.mjs";

const temporaryRoots: string[] = [];
const noLock = async () => async () => {};

function write(root: string, name: string, contents: string) {
  const filename = path.join(root, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
}

function fixture(): DesktopBuildConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serendipity-desktop-build-test-"));
  temporaryRoots.push(root);
  const projectRoot = path.join(root, "project");
  write(projectRoot, "app/page.tsx", "export default function Page() { return 'one'; }");
  write(projectRoot, "lib/example.ts", "export const value = 1;");
  write(projectRoot, "package.json", '{"name":"desktop-build-fixture"}');
  write(projectRoot, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"] }));
  write(projectRoot, ".next-old/BUILD_ID", "previous-build");
  write(projectRoot, ".next-old/server/old.js", "keep this production artifact");
  return { projectRoot, dataDirectory: path.join(root, "business-data"), runtimeDirectory: path.join(root, "business-data", "runtime"), nodePath: process.execPath, buildDirectory: ".next-old", autoBuild: true };
}

const completeBuild = (request: DesktopBuildRequest) => {
  write(request.cwd, `${request.env.SERENDIPITY_BUILD_DIR}/BUILD_ID`, "fixture-build-id\n");
};

function builder(effect: (request: DesktopBuildRequest) => void | Promise<void> = completeBuild) {
  return vi.fn(async (request: DesktopBuildRequest) => { await effect(request); });
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("desktop build preparation", () => {
  it("leaves manual-build configurations untouched without reading project files", async () => {
    const config = { ...fixture(), projectRoot: "not-a-real-project", autoBuild: false };
    const executor = builder();
    const acquireBuildLock = vi.fn(noLock);
    const result = await prepareDesktopBuild(config, { executor, acquireBuildLock });
    expect(result).toEqual({ config, changed: false, fingerprint: "" });
    expect(result.config).toBe(config);
    expect(executor).not.toHaveBeenCalled();
    expect(acquireBuildLock).not.toHaveBeenCalled();
  });

  it("reuses a verified current artifact or finds it from a stale configured directory", async () => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    const current = await prepareDesktopBuild(first.config, options);
    const discovered = await prepareDesktopBuild(config, options);
    expect(first.config.buildDirectory).toMatch(/^\.next-auto-[a-f0-9]{12}-[a-f0-9]{8}$/);
    expect(first.changed).toBe(true);
    expect(current).toEqual({ config: first.config, changed: false, fingerprint: first.fingerprint });
    expect(discovered).toEqual(first);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(config.buildDirectory).toBe(".next-old");
    const metadata = JSON.parse(fs.readFileSync(path.join(config.projectRoot, first.config.buildDirectory, "desktop-build.json"), "utf8"));
    expect(metadata).toMatchObject({ version: 1, fingerprint: first.fingerprint, buildId: "fixture-build-id", nodeVersion: process.version });
  });

  it("detects changed contents even when file size and modification time are preserved", async () => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    const filename = path.join(config.projectRoot, "lib/example.ts");
    const old = fs.statSync(filename);
    fs.writeFileSync(filename, "export const value = 2;");
    fs.utimesSync(filename, old.atime, old.mtime);
    const updated = await prepareDesktopBuild(first.config, options);
    expect(updated.fingerprint).not.toBe(first.fingerprint);
    expect(updated.config.buildDirectory).not.toBe(first.config.buildDirectory);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("records launcher ownership when builds are reused across distinct data directories", async () => {
    const config = fixture();
    const firstConfigFile = path.join(config.dataDirectory, "runtime/launcher.json");
    const executor = builder();
    const first = await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock, configFile: firstConfigFile });
    const other = { ...first.config, dataDirectory: path.join(config.dataDirectory, "second user"), runtimeDirectory: path.join(config.dataDirectory, "second user/runtime") };
    const secondConfigFile = path.join(other.runtimeDirectory, "launcher.json");
    await prepareDesktopBuild(other, { executor, acquireBuildLock: noLock, configFile: secondConfigFile });
    await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock, configFile: firstConfigFile });
    const metadata = JSON.parse(fs.readFileSync(path.join(config.projectRoot, first.config.buildDirectory, "desktop-build.json"), "utf8"));
    expect(metadata.owners.sort()).toEqual([firstConfigFile, secondConfigFile].sort());
    expect(Number.isNaN(Date.parse(metadata.lastUsedAt))).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("detects newly added and deleted source without relying on git", async () => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    write(config.projectRoot, "app/new/page.tsx", "export default () => 'new';");
    const added = await prepareDesktopBuild(first.config, options);
    expect(added.fingerprint).not.toBe(first.fingerprint);
    fs.unlinkSync(path.join(config.projectRoot, "lib/example.ts"));
    const deleted = await prepareDesktopBuild(added.config, options);
    expect(deleted.fingerprint).not.toBe(added.fingerprint);
    expect(executor).toHaveBeenCalledTimes(3);
  });

  it.each(["public/icon.svg", "prisma/schema.prisma", "scripts/serve.mjs", "types/custom.d.ts", "next.config.ts", "postcss.config.mjs", "proxy.ts", "package-lock.json", ".env.local"])("rebuilds for the %s input", async (filename) => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    write(config.projectRoot, filename, "new build input");
    const changed = await prepareDesktopBuild(first.config, options);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(config.runtimeDirectory!, "build.log"), "utf8")).not.toContain("new build input");
  });

  it("ignores documentation, tests, data, logs and generated build artifacts", async () => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    for (const filename of ["README.md", "docs/guide.md", "tests/example.test.ts", "data/example.json", "logs/output.log", ".next-other/BUILD_ID", "next-env.d.ts", "tsconfig.tsbuildinfo", "lib/__tests__/example.ts", "scripts/logs/output.txt"]) {
      write(config.projectRoot, filename, "irrelevant generated or local contents");
    }
    const unchanged = await prepareDesktopBuild(first.config, options);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.fingerprint).toBe(first.fingerprint);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild or reject a build when independent review and screenshot tools change", async () => {
    const config = fixture();
    const executor = builder((request) => {
      completeBuild(request);
      for (const filename of ["scripts/export-for-review.mjs", "scripts/export-review-core.mjs", "scripts/windows/install-review-export.ps1", "scripts/capture-gallery.mjs", "scripts/verify-gallery.mjs"]) {
        write(config.projectRoot, filename, "independent tooling changed during compilation");
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(config.projectRoot, "package.json"), "utf8"));
      manifest.scripts = { "export:review": "node scripts/export-for-review.mjs" };
      write(config.projectRoot, "package.json", JSON.stringify(manifest));
    });
    const first = await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock });
    const second = await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock });
    expect(second.changed).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
    write(config.projectRoot, "package.json", '{"name":"desktop-build-fixture","dependencies":{"next":"new-version"}}');
    await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("copies only compile caches into a new build without changing the previous artifact", async () => {
    const config = fixture();
    const first = await prepareDesktopBuild(config, { acquireBuildLock: noLock, executor: builder((request) => {
      completeBuild(request);
      const directory = request.env.SERENDIPITY_BUILD_DIR;
      write(request.cwd, `${directory}/cache/webpack/client-production/0.pack`, "cached compilation");
      write(request.cwd, `${directory}/cache/.tsbuildinfo`, "incremental types");
      write(request.cwd, `${directory}/cache/.rscinfo`, "stable compilation salt");
      write(request.cwd, `${directory}/cache/fetch-cache/business.json`, "must not inherit");
      write(request.cwd, `${directory}/server/previous.js`, "old server artifact");
    }) });
    write(config.projectRoot, "lib/example.ts", "export const value = 2;");
    const onProgress = vi.fn();
    const next = await prepareDesktopBuild(first.config, { acquireBuildLock: noLock, onProgress, executor: builder((request) => {
      const directory = request.env.SERENDIPITY_BUILD_DIR;
      const cachedFile = path.join(request.cwd, `${directory}/cache/webpack/client-production/0.pack`);
      expect(fs.readFileSync(cachedFile, "utf8")).toBe("cached compilation");
      expect(fs.readFileSync(path.join(request.cwd, `${directory}/cache/.tsbuildinfo`), "utf8")).toBe("incremental types");
      expect(fs.readFileSync(path.join(request.cwd, `${directory}/cache/.rscinfo`), "utf8")).toBe("stable compilation salt");
      expect(fs.existsSync(path.join(request.cwd, `${directory}/cache/fetch-cache`))).toBe(false);
      expect(fs.existsSync(path.join(request.cwd, `${directory}/server`))).toBe(false);
      fs.writeFileSync(cachedFile, "new compilation cache");
      completeBuild(request);
    }) });
    expect(next.config.buildDirectory).not.toBe(first.config.buildDirectory);
    expect(fs.readFileSync(path.join(config.projectRoot, first.config.buildDirectory, "cache/webpack/client-production/0.pack"), "utf8")).toBe("cached compilation");
    expect(onProgress).toHaveBeenCalledWith("已复用编译缓存，正在构建新版");
  });

  it("ignores an unverified or incompatible cache and still builds", async () => {
    const config = fixture();
    const first = await prepareDesktopBuild(config, { executor: builder(), acquireBuildLock: noLock });
    const metadataPath = path.join(config.projectRoot, first.config.buildDirectory, "desktop-build.json");
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    write(config.projectRoot, `${first.config.buildDirectory}/cache/.tsbuildinfo`, "incompatible cache");
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, nodeVersion: "v0.0.0" }));
    write(config.projectRoot, "lib/example.ts", "export const value = 2;");
    await prepareDesktopBuild(first.config, { acquireBuildLock: noLock, executor: builder((request) => {
      expect(fs.existsSync(path.join(request.cwd, `${request.env.SERENDIPITY_BUILD_DIR}/cache/.tsbuildinfo`))).toBe(false);
      completeBuild(request);
    }) });
  });

  it("recovers a failed cached build with one cold build in a new directory", async () => {
    const config = fixture();
    const first = await prepareDesktopBuild(config, { acquireBuildLock: noLock, executor: builder((request) => {
      completeBuild(request);
      for (const name of ["webpack/client-production/0.pack", "swc/cache.bin", ".tsbuildinfo", ".rscinfo"]) {
        write(request.cwd, `${request.env.SERENDIPITY_BUILD_DIR}/cache/${name}`, "previous compile state");
      }
    }) });
    write(config.projectRoot, "lib/example.ts", "export const value = 2;");
    const outputs: string[] = [];
    const onProgress = vi.fn();
    const executor = builder((request) => {
      const directory = request.env.SERENDIPITY_BUILD_DIR!;
      outputs.push(directory);
      const cache = path.join(request.cwd, directory, "cache");
      if (outputs.length === 1) {
        expect(fs.existsSync(path.join(cache, "webpack/client-production/0.pack"))).toBe(true);
        write(request.cwd, `${directory}/partial.txt`, "failed output for diagnostics");
        throw new Error("snapshot hash is undefined");
      }
      expect(fs.readdirSync(cache)).toEqual(["tsconfig.json"]);
      completeBuild(request);
    });
    const result = await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock, onProgress });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(new Set(outputs).size).toBe(2);
    expect(result.config.buildDirectory).toBe(outputs[1]);
    expect(fs.existsSync(path.join(config.projectRoot, outputs[0], "desktop-build.json"))).toBe(false);
    expect(fs.readFileSync(path.join(config.projectRoot, outputs[0], "partial.txt"), "utf8")).toBe("failed output for diagnostics");
    expect(fs.readFileSync(path.join(config.projectRoot, first.config.buildDirectory, "cache/webpack/client-production/0.pack"), "utf8")).toBe("previous compile state");
    expect(JSON.parse(fs.readFileSync(path.join(config.projectRoot, outputs[1], "desktop-build.json"), "utf8")).cacheReused).toBe(false);
    expect(onProgress).toHaveBeenCalledWith("缓存构建未通过，正在使用全新缓存自动重试一次");
    expect(fs.readFileSync(path.join(config.runtimeDirectory!, "build.log"), "utf8")).toContain("snapshot hash is undefined");
    const unchanged = await prepareDesktopBuild(result.config, { executor, acquireBuildLock: noLock });
    expect(unchanged.changed).toBe(false);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("stops after the cold retry also fails and leaves the verified version intact", async () => {
    const config = fixture();
    const first = await prepareDesktopBuild(config, { acquireBuildLock: noLock, executor: builder((request) => {
      completeBuild(request);
      write(request.cwd, `${request.env.SERENDIPITY_BUILD_DIR}/cache/webpack/0.pack`, "verified version cache");
    }) });
    write(config.projectRoot, "lib/example.ts", "export const value = 2;");
    const outputs: string[] = [];
    const release = vi.fn(async () => {});
    const executor = builder((request) => {
      outputs.push(request.env.SERENDIPITY_BUILD_DIR!);
      throw new Error(outputs.length === 1 ? "cached compile failed" : "cold compile failed");
    });
    await expect(prepareDesktopBuild(first.config, { executor, acquireBuildLock: async () => release })).rejects.toThrow("cold compile failed");
    expect(executor).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    for (const directory of outputs) expect(fs.existsSync(path.join(config.projectRoot, directory, "desktop-build.json"))).toBe(false);
    expect(fs.readFileSync(path.join(config.projectRoot, first.config.buildDirectory, "BUILD_ID"), "utf8")).toBe("fixture-build-id\n");
    expect(fs.readFileSync(path.join(config.projectRoot, first.config.buildDirectory, "cache/webpack/0.pack"), "utf8")).toBe("verified version cache");
  });

  it("still rechecks source changes after recovering a failed cache", async () => {
    const config = fixture();
    const first = await prepareDesktopBuild(config, { acquireBuildLock: noLock, executor: builder((request) => {
      completeBuild(request);
      write(request.cwd, `${request.env.SERENDIPITY_BUILD_DIR}/cache/webpack/0.pack`, "compile state");
    }) });
    write(config.projectRoot, "lib/example.ts", "export const value = 2;");
    const outputs: string[] = [];
    const executor = builder((request) => {
      outputs.push(request.env.SERENDIPITY_BUILD_DIR!);
      if (outputs.length === 1) throw new Error("snapshot failed");
      completeBuild(request);
      if (outputs.length === 2) write(request.cwd, "lib/example.ts", "export const value = 3;");
      expect(fs.existsSync(path.join(request.cwd, request.env.SERENDIPITY_BUILD_DIR!, "cache/webpack"))).toBe(false);
    });
    const result = await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock });
    expect(executor).toHaveBeenCalledTimes(3);
    expect(result.config.buildDirectory).toBe(outputs[2]);
    for (const directory of outputs.slice(0, 2)) expect(fs.existsSync(path.join(config.projectRoot, directory, "desktop-build.json"))).toBe(false);
  });

  it("accepts a verified build when Next has already removed the pending marker", async () => {
    const config = fixture();
    const executor = builder((request) => {
      fs.unlinkSync(path.join(request.cwd, request.env.SERENDIPITY_BUILD_DIR!, "desktop-build-pending.json"));
      completeBuild(request);
    });
    const result = await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock });
    expect(result.changed).toBe(true);
    expect(fs.existsSync(path.join(config.projectRoot, result.config.buildDirectory, "desktop-build.json"))).toBe(true);
    expect((await prepareDesktopBuild(result.config, { executor, acquireBuildLock: noLock })).changed).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("checks current route types without accumulating historical build types or rewriting root config", async () => {
    const config = fixture();
    write(config.projectRoot, ".next-old/types/validator.ts", "old route validator");
    const original = fs.readFileSync(path.join(config.projectRoot, "tsconfig.json"), "utf8");
    await prepareDesktopBuild(config, { acquireBuildLock: noLock, executor: builder((request) => {
      expect(request.env.SERENDIPITY_DESKTOP_BUILD).toBe("1");
      const directory = request.env.SERENDIPITY_BUILD_DIR!;
      write(request.cwd, `${directory}/types/validator.ts`, "current route validator");
      const filename = path.join(request.cwd, directory, "cache/tsconfig.json");
      const parsed = ts.readConfigFile(filename, ts.sys.readFile);
      const resolved = ts.parseJsonConfigFileContent(parsed.config, ts.sys, path.dirname(filename));
      expect(resolved.errors).toEqual([]);
      expect(resolved.fileNames).toContain(path.join(request.cwd, directory, "types/validator.ts").replaceAll("\\", "/"));
      expect(resolved.fileNames.some((name) => name.includes(".next-old"))).toBe(false);
      expect(resolved.fileNames).toContain(path.join(request.cwd, "app/page.tsx").replaceAll("\\", "/"));
      expect(resolved.options.strict).toBe(true);
      completeBuild(request);
    }) });
    expect(fs.readFileSync(path.join(config.projectRoot, "tsconfig.json"), "utf8")).toBe(original);
  });

  it("automatically retries one save during compilation and reports changed filenames without their contents", async () => {
    const config = fixture();
    const directories: string[] = [];
    const onProgress = vi.fn();
    const executor = builder((request) => {
      directories.push(request.env.SERENDIPITY_BUILD_DIR!);
      completeBuild(request);
      if (directories.length === 1) write(request.cwd, "app/page.tsx", "private new source text");
    });
    const result = await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock, onProgress });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(result.config.buildDirectory).toBe(directories[1]);
    expect(fs.existsSync(path.join(config.projectRoot, directories[0], "desktop-build.json"))).toBe(false);
    const log = fs.readFileSync(path.join(config.runtimeDirectory!, "build.log"), "utf8");
    expect(log).toContain("Build inputs changed: app/page.tsx");
    expect(log).not.toContain("private new source text");
    expect(onProgress).toHaveBeenCalledWith("检测到构建期间保存了修改，正在自动重试一次");
  });

  it("normalizes Next's generated tsconfig includes so a successful build does not trigger a loop", async () => {
    const config = fixture();
    const executor = builder((request) => {
      completeBuild(request);
      const filename = path.join(request.cwd, "tsconfig.json");
      const tsconfig = JSON.parse(fs.readFileSync(filename, "utf8"));
      tsconfig.include.push(`${request.env.SERENDIPITY_BUILD_DIR}/types/**/*.ts`, `${request.env.SERENDIPITY_BUILD_DIR}/dev/types/**/*.ts`);
      fs.writeFileSync(filename, JSON.stringify(tsconfig, null, 2));
      write(request.cwd, "next-env.d.ts", `import './${request.env.SERENDIPITY_BUILD_DIR}/types/routes.d.ts';`);
    });
    const first = await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock });
    const unchanged = await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock });
    expect(unchanged.fingerprint).toBe(first.fingerprint);
    expect(unchanged.changed).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
    const filename = path.join(config.projectRoot, "tsconfig.json");
    const tsconfig = JSON.parse(fs.readFileSync(filename, "utf8"));
    tsconfig.compilerOptions.strict = false;
    fs.writeFileSync(filename, JSON.stringify(tsconfig));
    const changed = await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock });
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("also handles commented TypeScript configs without discarding real config changes", async () => {
    const config = fixture();
    write(config.projectRoot, "tsconfig.json", '{ // source comment\n "compilerOptions": { "strict": true, }, "include": ["**/*.ts", ".next-old/types/**/*.ts",], }');
    const executor = builder();
    const first = await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock });
    write(config.projectRoot, "tsconfig.json", '{ // changed comment\n "compilerOptions": { "strict": true }, "include": ["**/*.ts", ".next-new/types/**/*.ts"] }');
    const unchanged = await prepareDesktopBuild(first.config, { executor, acquireBuildLock: noLock });
    expect(unchanged.fingerprint).toBe(first.fingerprint);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("reuses the same build across irrelevant terminal and desktop environment changes", async () => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    vi.stubEnv("npm_lifecycle_event", "changed-terminal-command");
    vi.stubEnv("PSModulePath", "different-powershell-session");
    vi.stubEnv("PWD", "different-shell-directory");
    vi.stubEnv("SERENDIPITY_DATA_DIR", "different-business-data-directory");
    const unchanged = await prepareDesktopBuild(first.config, options);
    expect(unchanged.fingerprint).toBe(first.fingerprint);
    expect(unchanged.changed).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each(["NEXT_PUBLIC_DESKTOP_BUILD_TEST", "CUSTOM_DESKTOP_BUILD_TEST"])("rebuilds when compile-time %s changes", async (key) => {
    const config = fixture();
    write(config.projectRoot, "next.config.ts", "export default { env: { custom: process.env['CUSTOM_DESKTOP_BUILD_TEST'] } };");
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    vi.stubEnv(key, "changed-compile-setting");
    const changed = await prepareDesktopBuild(first.config, options);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(path.join(config.runtimeDirectory!, "build.log"), "utf8")).not.toContain("changed-compile-setting");
  });

  it("uses the configured runtime, redirects build output and isolates inherited business settings", async () => {
    const config = fixture();
    vi.stubEnv("SERENDIPITY_DATA_DIR", config.dataDirectory);
    vi.stubEnv("SERENDIPITY_PUBLIC_ORIGIN", "https://business.example");
    vi.stubEnv("DATABASE_URL", "file:business-database");
    vi.stubEnv("NODE_OPTIONS", "--inspect");
    vi.stubEnv("PORT", "3100");
    let guard: string | undefined;
    const executor = builder((request) => {
      expect(request.command).toBe(config.nodePath);
      expect(request.args).toEqual([path.join(config.projectRoot, "node_modules/next/dist/bin/next"), "build", "--webpack"]);
      expect(request.cwd).toBe(config.projectRoot);
      expect(request.windowsHide).toBe(true);
      expect(request.env.SERENDIPITY_PUBLIC_ORIGIN).toBeUndefined();
      expect(request.env.NODE_OPTIONS).toBeUndefined();
      expect(request.env.PORT).toBeUndefined();
      guard = request.env.SERENDIPITY_DATA_DIR;
      expect(guard).toBeTruthy();
      expect(guard).not.toBe(config.dataDirectory);
      expect(fs.statSync(guard!).isFile()).toBe(true);
      expect(request.env.DATABASE_URL).toBe(`file:${path.join(guard!, "data", "serendipity.db").replaceAll("\\", "/")}`);
      expect(request.stdio[0]).toBe("ignore");
      expect(request.stdio[1]).toBe(request.stdio[2]);
      fs.writeSync(request.stdio[1], "compiler output captured in the log\n");
      completeBuild(request);
    });
    await prepareDesktopBuild(config, { executor, acquireBuildLock: noLock });
    expect(fs.existsSync(guard!)).toBe(false);
    expect(fs.readFileSync(path.join(config.runtimeDirectory!, "build.log"), "utf8")).toContain("compiler output captured in the log");
    expect(fs.existsSync(path.join(config.dataDirectory, "data"))).toBe(false);
  });

  it.each(["executor failure", "missing BUILD_ID", "empty BUILD_ID", "source changed during build"])("never activates a candidate after %s", async (failure) => {
    const config = fixture();
    const original = { ...config };
    let candidate: string | undefined;
    let guard: string | undefined;
    const release = vi.fn(async () => {});
    const executor = builder((request) => {
      candidate = request.env.SERENDIPITY_BUILD_DIR;
      guard = request.env.SERENDIPITY_DATA_DIR;
      if (failure === "executor failure") throw new Error("compiler failed");
      if (failure === "missing BUILD_ID") return;
      if (failure === "empty BUILD_ID") { write(request.cwd, `${candidate}/BUILD_ID`, "  \n"); return; }
      completeBuild(request);
      write(request.cwd, "app/page.tsx", `changed during build ${candidate}`);
    });
    await expect(prepareDesktopBuild(config, { executor, acquireBuildLock: async () => release })).rejects.toThrow(path.join(config.runtimeDirectory!, "build.log"));
    expect(config).toEqual(original);
    expect(fs.readFileSync(path.join(config.projectRoot, ".next-old/BUILD_ID"), "utf8")).toBe("previous-build");
    expect(fs.readFileSync(path.join(config.projectRoot, ".next-old/server/old.js"), "utf8")).toBe("keep this production artifact");
    expect(fs.existsSync(path.join(config.projectRoot, candidate!, "desktop-build.json"))).toBe(false);
    expect(fs.existsSync(guard!)).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("allocates unique output after failure and preserves every previous artifact", async () => {
    const config = fixture();
    const outputs: string[] = [];
    const executor = builder((request) => {
      outputs.push(request.env.SERENDIPITY_BUILD_DIR!);
      write(request.cwd, `${request.env.SERENDIPITY_BUILD_DIR}/partial.txt`, "preserved diagnostic output");
      throw new Error("build failed");
    });
    for (let i = 0; i < 2; i++) await expect(prepareDesktopBuild(config, { executor, acquireBuildLock: noLock })).rejects.toThrow("build failed");
    expect(new Set(outputs).size).toBe(2);
    for (const directory of outputs) expect(fs.readFileSync(path.join(config.projectRoot, directory, "partial.txt"), "utf8")).toBe("preserved diagnostic output");
    expect(fs.readFileSync(path.join(config.projectRoot, ".next-old/BUILD_ID"), "utf8")).toBe("previous-build");
  });

  it("rejects stale metadata when its BUILD_ID has been replaced", async () => {
    const config = fixture();
    const executor = builder();
    const options = { executor, acquireBuildLock: noLock };
    const first = await prepareDesktopBuild(config, options);
    write(config.projectRoot, `${first.config.buildDirectory}/BUILD_ID`, "unverified-replacement");
    const replacement = await prepareDesktopBuild(first.config, options);
    expect(replacement.fingerprint).toBe(first.fingerprint);
    expect(replacement.config.buildDirectory).not.toBe(first.config.buildDirectory);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it.skipIf(process.platform !== "win32")("serializes builds for one project even across distinct data directories", async () => {
    const config = fixture();
    const other = { ...config, dataDirectory: path.join(config.dataDirectory, "other"), runtimeDirectory: path.join(config.dataDirectory, "other", "runtime") };
    let finishFirst!: () => void;
    let startedFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve; });
    const firstCanFinish = new Promise<void>((resolve) => { finishFirst = resolve; });
    const firstExecutor = builder(async (request) => { startedFirst(); await firstCanFinish; completeBuild(request); });
    const secondExecutor = builder();
    const first = prepareDesktopBuild(config, { executor: firstExecutor });
    await firstStarted;
    const second = prepareDesktopBuild(other, { executor: secondExecutor });
    finishFirst();
    const [preparedFirst, preparedSecond] = await Promise.all([first, second]);
    expect(preparedSecond.config.buildDirectory).toBe(preparedFirst.config.buildDirectory);
    expect(firstExecutor).toHaveBeenCalledTimes(1);
    expect(secondExecutor).not.toHaveBeenCalled();
  });
});
