import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertTestDataPath, assertTestDataTree } from "../scripts/test-data-safety.mjs";

const retired = [
  "verify-phase03", "verify-phase04", "verify-phase05", "verify-phase06",
  "verify-phase07", "verify-phase08", "verify-phase09", "verify-phase10",
  "capture-phase04-screens", "capture-phase05-screens", "capture-phase06-screens",
];
const external = ["verify-phase11", "verify-phase12", "verify-phase13", "verify-phase13-manual", "probe-free-map"];
let fixture: string;
const links: string[] = [];
beforeEach(() => {
  const prefix = assertTestDataPath(path.resolve("test-data", "legacy-verification-"));
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  fixture = fs.mkdtempSync(prefix);
});
afterEach(() => {
  for (const link of links.splice(0).reverse()) fs.unlinkSync(link);
  fs.rmSync(assertTestDataTree(fixture), { recursive: true, force: true });
});

function run(name: string, args: string[] = []) {
  return spawnSync(process.execPath, [path.resolve("scripts", `${name}.mjs`), ...args], {
    cwd: fixture,
    env: { ...process.env, SERENDIPITY_DATA_DIR: path.join(fixture, "business-sentinel") },
    encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
}

function linkedDirectory(relative: string) {
  const sentinelDirectory = path.join(fixture, "business-sentinel");
  fs.mkdirSync(sentinelDirectory, { recursive: true });
  const sentinel = path.join(sentinelDirectory, "serendipity.db");
  fs.writeFileSync(sentinel, "synthetic business sentinel, never a real database");
  const link = path.join(fixture, relative);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(sentinelDirectory, link, "junction");
  links.push(link);
  return sentinel;
}

describe("historical verification entry points", () => {
  it.each(retired)("%s exits before any cleanup, database access or network calls", (name) => {
    const sentinel = linkedDirectory("test-data/phase03/data");
    const before = fs.statSync(sentinel);
    const result = run(name);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("已停用");
    expect(result.stderr).toContain("npm test");
    expect(result.stderr).toContain("npm run test:e2e");
    expect(fs.readFileSync(sentinel, "utf8")).toContain("synthetic business sentinel");
    expect(fs.statSync(sentinel).mtimeMs).toBe(before.mtimeMs);
    expect(fs.readdirSync(fixture).sort()).toEqual(["business-sentinel", "test-data"]);
    expect(fs.readdirSync(path.join(fixture, "test-data"))).toEqual(["phase03"]);
  });

  it.each(external)("%s refuses external work by default without creating output or opening a database", (name) => {
    const result = run(name);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--allow-external");
    expect(fs.readdirSync(fixture)).toEqual([]);
  });

  it.each([
    ["verify-phase11", "test-data/phase11-live"],
    ["verify-phase12", "test-data/phase11-live"],
    ["verify-phase13", "test-data/phase13-live"],
    ["verify-phase13-manual", "test-data/phase13-live"],
    ["probe-free-map", "test-data/phase11-evidence"],
  ])("%s refuses linked data even with external work explicitly enabled", (name, target) => {
    const sentinel = linkedDirectory(target);
    const result = run(name, ["--allow-external"]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("linked test-data");
    expect(fs.readFileSync(sentinel, "utf8")).toContain("synthetic business sentinel");
    expect(fs.existsSync(path.join(fixture, "docs"))).toBe(false);
  });

  it("the public unit test launcher rejects a linked legacy cleanup path before loading Vitest", () => {
    const sentinel = linkedDirectory("test-data/unit-security");
    const result = run("run-isolated-tests");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("linked test-data");
    expect(fs.readFileSync(sentinel, "utf8")).toContain("synthetic business sentinel");
  });

  it("the standalone test server rejects a business data directory before migrations or listening", () => {
    fs.mkdirSync(path.join(fixture, "business-sentinel"));
    const sentinel = path.join(fixture, "business-sentinel", "serendipity.db");
    fs.writeFileSync(sentinel, "synthetic business sentinel");
    const result = run("start-test-server");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("outside a project test-data");
    expect(fs.readFileSync(sentinel, "utf8")).toBe("synthetic business sentinel");
    expect(fs.readdirSync(fixture)).toEqual(["business-sentinel"]);
  });
});
