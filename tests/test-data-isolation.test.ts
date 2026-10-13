import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertTestDataPath, assertTestDataTree } from "../scripts/test-data-safety.mjs";
import { openVerifiedIsolatedDatabase } from "../scripts/verify-isolated-server.mjs";
import { isolatedDatabase } from "./helpers/test-database";

const cleanScript = path.resolve("scripts/clean-test-data.mjs");

describe("test data cleanup boundaries", () => {
  let fixture: string;
  const links: string[] = [];
  beforeEach(() => {
    const prefix = assertTestDataPath(path.resolve("test-data", "isolation-safety-"));
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    fixture = fs.mkdtempSync(prefix);
  });
  afterEach(() => {
    // Remove only links created by this test, never their destinations.
    for (const link of links.splice(0).reverse()) {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    }
    fs.rmSync(assertTestDataTree(fixture), { recursive: true, force: true });
  });

  function clean(project: string, directory: string) {
    return spawnSync(process.execPath, [cleanScript], {
      cwd: project, env: { ...process.env, SERENDIPITY_DATA_DIR: directory }, encoding: "utf8",
    });
  }

  it("cleans only the selected test database directory and rejects paths outside it", () => {
    const project = path.join(fixture, "project");
    const selected = path.join(project, "test-data", "e2e");
    const sibling = path.join(project, "test-data", "other");
    fs.mkdirSync(path.join(selected, "data"), { recursive: true });
    fs.mkdirSync(path.join(sibling, "data"), { recursive: true });
    fs.writeFileSync(path.join(selected, "data", "test.db"), "test-only");
    const sentinel = path.join(sibling, "data", "sentinel.txt");
    fs.writeFileSync(sentinel, "keep sibling");
    expect(clean(project, selected).status).toBe(0);
    expect(fs.readdirSync(path.join(selected, "data"))).toEqual([]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep sibling");
    expect(clean(project, fixture).status).not.toBe(0);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep sibling");
    expect(() => assertTestDataPath(path.join(project, "test-data"), project)).toThrow();
    expect(() => isolatedDatabase("../outside")).toThrow("Invalid isolated database name");
  });

  it.each(["test-root", "data-directory", "nested-directory"])("refuses a %s junction before deleting any sentinel", (position) => {
    const project = path.join(fixture, "project");
    const selected = path.join(project, "test-data", "e2e");
    const external = path.join(fixture, "sentinel-directory");
    const link = position === "test-root" ? path.join(project, "test-data")
      : position === "data-directory" ? path.join(selected, "data") : path.join(selected, "data", "nested");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.mkdirSync(path.join(external, "e2e", "data"), { recursive: true });
    const sentinel = path.join(external, "e2e", "data", "sentinel.txt");
    fs.writeFileSync(sentinel, "never delete");
    fs.symlinkSync(external, link, "junction");
    links.push(link);
    expect(clean(project, selected).status).not.toBe(0);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("never delete");
    expect(() => assertTestDataTree(path.join(selected, "data"), project)).toThrow("linked");
  });

  it("refuses a database hard link before connecting or changing either file", async () => {
    const dataDirectory = path.join(fixture, "hard-link-test");
    fs.mkdirSync(path.join(dataDirectory, "data"), { recursive: true });
    const sentinel = path.join(fixture, "sentinel.db");
    const database = path.join(dataDirectory, "data", "serendipity.db");
    fs.writeFileSync(sentinel, "synthetic sentinel, not a real database");
    fs.linkSync(sentinel, database);
    try {
      await expect(openVerifiedIsolatedDatabase("http://127.0.0.1:1", dataDirectory)).rejects.toThrow("linked");
      expect(fs.readFileSync(sentinel, "utf8")).toBe("synthetic sentinel, not a real database");
    } finally { fs.unlinkSync(database); }
  });
});

describe("phase 13 browser/database handshake", () => {
  let first: ReturnType<typeof isolatedDatabase>;
  let second: ReturnType<typeof isolatedDatabase>;
  let firstClient: PrismaClient;
  let secondClient: PrismaClient;
  const servers: http.Server[] = [];
  const methods: string[] = [];
  beforeAll(() => {
    first = isolatedDatabase("isolation-server-a");
    second = isolatedDatabase("isolation-server-b");
    firstClient = new PrismaClient({ datasources: { db: { url: first.databaseUrl } } });
    secondClient = new PrismaClient({ datasources: { db: { url: second.databaseUrl } } });
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    expect(methods.splice(0).every((method) => method === "GET")).toBe(true);
    expect(await firstClient.trip.count()).toBe(0);
    expect(await secondClient.trip.count()).toBe(0);
  });
  afterAll(async () => {
    await Promise.all([firstClient?.$disconnect(), secondClient?.$disconnect()]);
    first?.cleanup(); second?.cleanup();
  });

  async function server(database: PrismaClient, behavior: "normal" | "mismatch" | "redirect" = "normal") {
    const instance = http.createServer(async (request, response) => {
      methods.push(request.method ?? "");
      const id = request.url?.split("/").at(-1) ?? "";
      const trip = await database.trip.findUnique({ where: { id } });
      if (behavior === "redirect") {
        response.writeHead(302, { Location: "/unexpected" }); response.end(); return;
      }
      response.writeHead(trip ? 200 : 404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ trip: behavior === "mismatch" && trip ? { ...trip, originalRequest: "wrong-marker" } : trip }));
    });
    await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve));
    servers.push(instance);
    return `http://127.0.0.1:${(instance.address() as AddressInfo).port}`;
  }

  it("allows the matching isolated server and removes only its fresh marker", async () => {
    const keep = await firstClient.trip.create({ data: { title: "existing synthetic trip", originalRequest: "keep this test row", status: "draft" } });
    try {
      const client = await openVerifiedIsolatedDatabase(await server(firstClient), first.directory);
      await client.$disconnect();
      expect(await firstClient.trip.findUnique({ where: { id: keep.id } })).toMatchObject({ originalRequest: "keep this test row" });
      expect(await firstClient.trip.count()).toBe(1);
    } finally { await firstClient.trip.delete({ where: { id: keep.id } }); }
  });

  it("rejects a server using another isolated database without any HTTP writes", async () => {
    await expect(openVerifiedIsolatedDatabase(await server(secondClient), first.directory)).rejects.toThrow("does not expose");
    expect(methods).toEqual(["GET"]);
  });

  it.each(["mismatch", "redirect"] as const)("rejects %s responses and removes the marker on failure", async (behavior) => {
    await expect(openVerifiedIsolatedDatabase(await server(firstClient, behavior), first.directory)).rejects.toThrow();
    expect(methods).toEqual(["GET"]);
  });

  it("rejects non-loopback destinations before creating any marker", async () => {
    await expect(openVerifiedIsolatedDatabase("https://example.com", first.directory)).rejects.toThrow("loopback");
    expect(methods).toEqual([]);
  });
});
