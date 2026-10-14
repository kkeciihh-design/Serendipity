import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";

// Local storage checks only. Browser scenarios produce the synthetic fixtures.
const output = path.resolve("docs/阶段验收/证据/阶段-14");
fs.mkdirSync(output, { recursive: true });
const mode = process.argv[2];
const base = "http://127.0.0.1:3122";
const write = (name, value) => fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`);
const read = (name) => JSON.parse(fs.readFileSync(path.join(output, name), "utf8"));
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;

if (mode === "formal-before" || mode === "formal-after") {
  assert.ok(process.env.LOCALAPPDATA, "LOCALAPPDATA is required; do not guess a business database path.");
  const databasePath = path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(Object.values(database.prepare("PRAGMA integrity_check").get())[0], "ok");
    const before = mode === "formal-after" ? read("formal-before.json") : null;
    const tables = before?.tables ?? database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name").all().map(({ name }) => ({ name, columns: database.prepare(`PRAGMA table_info(${quote(name)})`).all().map((column) => column.name) }));
    const fingerprints = tables.map(({ name, columns }) => {
      const rows = database.prepare(`SELECT ${columns.map(quote).join(",")} FROM ${quote(name)}`).all().map((row) => JSON.stringify(row)).sort();
      return { name, columns, count: rows.length, hash: hash(rows) };
    });
    if (before) assert.deepEqual(fingerprints, before.tables, "Existing business fields changed during migration/startup.");
    const result = { checkedAt: new Date().toISOString(), databasePath, integrity: "ok", tables: fingerprints, status: "passed" };
    write(`${mode}.json`, result);
    console.log(`${mode}: integrity and ${fingerprints.length} business table fingerprints passed.`);
  } finally { database.close(); }
} else if (mode === "demo-seed" || mode === "demo-check") {
  const database = await openVerifiedIsolatedDatabase(base, "test-data/phase14-live");
  try {
    if (mode === "demo-seed") {
      const demos = [];
      for (const kind of ["train", "flight"]) {
        const snapshot = read(`${kind}-demo.json`);
        const trip = await database.trip.create({ data: { title: snapshot.trip.title, originalRequest: snapshot.trip.originalRequest, status: snapshot.trip.status } });
        const request = snapshot.request;
        await database.tripRequest.create({ data: {
          tripId: trip.id, originalRequest: trip.originalRequest, requestRevision: request.requestRevision,
          confirmedRevision: request.confirmedRevision, confirmedAt: request.confirmedAt ? new Date(request.confirmedAt) : null,
          extractedRequest: request.extractedRequest ? JSON.stringify(request.extractedRequest) : null,
          confirmedRequest: request.confirmedRequest ? JSON.stringify(request.confirmedRequest) : null,
        } });
        const source = snapshot.plan;
        const columns = Object.fromEntries(["requestSnapshot", "events", "costs", "places", "routeLegs", "tickets", "pendingItems", "validationResults"].map((key) => [key, JSON.stringify(source[key])]));
        const plan = await database.planVersion.create({ data: {
          tripId: trip.id, versionNumber: 1, requestRevision: source.requestRevision,
          requirementUpToDate: source.requirementUpToDate, ...columns,
        } });
        await database.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
        demos.push({ kind, tripId: trip.id, planId: plan.id, url: `${base}/trips/${trip.id}`, hash: hash(columns) });
      }
      write("demo-manifest.json", { checkedAt: new Date().toISOString(), dataDirectory: "test-data/phase14-live", scope: "Synthetic manually entered ticket and transfer data; no real bookings or schedules.", demos });
      console.log(JSON.stringify(demos.map(({ kind, url }) => ({ kind, url }))));
    } else {
      const manifest = read("demo-manifest.json");
      for (const demo of manifest.demos) {
        const plan = await database.planVersion.findUniqueOrThrow({ where: { id: demo.planId } });
        const columns = Object.fromEntries(["requestSnapshot", "events", "costs", "places", "routeLegs", "tickets", "pendingItems", "validationResults"].map((key) => [key, plan[key]]));
        assert.equal(hash(columns), demo.hash, "Stored ticket/plan fields changed across restart.");
        const response = await fetch(demo.url, { redirect: "error" });
        assert.equal(response.status, 200);
        const html = await response.text();
        for (const ticket of JSON.parse(plan.tickets)) if (ticket.serviceNumber) assert.ok(html.includes(ticket.serviceNumber));
      }
      write("demo-restart.json", { checkedAt: new Date().toISOString(), status: "passed", demos: manifest.demos.map(({ kind, url, hash: digest }) => ({ kind, url, hash: digest })) });
      console.log("demo-check: both complete ticket chains persisted and returned HTTP 200.");
    }
  } finally { await database.$disconnect(); }
} else {
  throw new Error("Expected formal-before, formal-after, demo-seed or demo-check.");
}
