import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";

const output = path.resolve("docs/阶段验收/证据/阶段-16");
fs.mkdirSync(output, { recursive: true });
const mode = process.argv[2];
const base = "http://127.0.0.1:3124";
const write = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const read = (name) => JSON.parse(fs.readFileSync(path.join(output, name), "utf8"));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const columns = ["requestSnapshot", "events", "costs", "places", "routeLegs", "tickets", "pendingItems", "validationResults"];

if (mode === "formal-before" || mode === "formal-after") {
  assert.ok(process.env.LOCALAPPDATA);
  const databasePath = path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(Object.values(database.prepare("PRAGMA integrity_check").get())[0], "ok");
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all();
    const tables = names.map(({ name }) => {
      const rows = database.prepare(`SELECT * FROM ${quote(name)}`).all().map((r) => JSON.stringify(r)).sort();
      return { name, count: rows.length, hash: hash(rows) };
    });
    if (mode === "formal-after") assert.deepEqual(tables, read("formal-before.json").tables);
    write(`${mode}.json`, { checkedAt: new Date().toISOString(), databasePath, integrity: "ok", tables, status: "passed" });
    console.log(`${mode}: business data fingerprints unchanged; integrity ok.`);
  } finally { database.close(); }
} else if (mode === "demo-seed" || mode === "demo-check") {
  const database = await openVerifiedIsolatedDatabase(base, "test-data/phase16-live");
  try {
    if (mode === "demo-seed") {
      assert.ok(!fs.existsSync(path.join(output, "demo-manifest.json")), "A demo already exists; use demo-check instead of duplicating it.");
      const snapshot = read("synthetic-demo.json");
      const source = snapshot.currentPlanVersion;
      const request = snapshot.request;
      const trip = await database.trip.create({ data: { title: "车票截图导入演示（合成数据）", originalRequest: snapshot.originalRequest, status: snapshot.status } });
      await database.tripRequest.create({ data: {
        tripId: trip.id, originalRequest: request.originalRequest, requestRevision: request.requestRevision,
        confirmedRevision: request.confirmedRevision, confirmedAt: new Date(request.confirmedAt),
        extractedRequest: request.extractedRequest, confirmedRequest: request.confirmedRequest,
      } });
      const plan = await database.planVersion.create({ data: {
        tripId: trip.id, versionNumber: 1, requestRevision: source.requestRevision, requirementUpToDate: source.requirementUpToDate,
        ...Object.fromEntries(columns.map((key) => [key, source[key]])),
      } });
      await database.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
      write("demo-manifest.json", { tripId: trip.id, planId: plan.id, url: `${base}/trips/${trip.id}`, versionNumber: 1,
        hash: hash(columns.map((key) => plan[key])), scope: "Synthetic tickets and routes, no real booking data" });
      console.log(`Demo created: ${base}/trips/${trip.id}`);
    } else {
      const manifest = read("demo-manifest.json");
      const trip = await database.trip.findUniqueOrThrow({ where: { id: manifest.tripId }, include: { currentPlanVersion: true } });
      const plan = trip.currentPlanVersion;
      assert.ok(plan);
      const response = await fetch(`${base}/api/trips/${trip.id}/plans/${plan.versionNumber}/redlines`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.planId, plan.id);
      assert.equal(payload.redlines.length, 1);
      const current = { checkedAt: new Date().toISOString(), planId: plan.id, hash: hash(columns.map((key) => plan[key])),
        suggestedAt: payload.redlines[0].suggestedAt, preferences: JSON.parse(plan.tickets).find((t) => t.status === "active").redlinePreferences ?? null,
        url: manifest.url, status: "passed" };
      const beforePath = path.join(output, "demo-before-restart.json");
      if (!fs.existsSync(beforePath)) write("demo-before-restart.json", current);
      else {
        const before = read("demo-before-restart.json");
        assert.equal(current.hash, before.hash); assert.equal(current.suggestedAt, before.suggestedAt);
        assert.deepEqual(current.preferences, before.preferences);
        write("demo-after-restart.json", current);
      }
      console.log(`Demo storage and redline API verified: ${manifest.url}`);
    }
  } finally { await database.$disconnect(); }
} else throw new Error("Expected formal-before, formal-after, demo-seed or demo-check.");
