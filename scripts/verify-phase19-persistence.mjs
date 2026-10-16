import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { openVerifiedIsolatedDatabase } from "./verify-isolated-server.mjs";
import { assertTestDataPath } from "./test-data-safety.mjs";
const mode = process.argv[2]; assert.ok(["before", "after"].includes(mode));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase19-live"));
const base = "http://127.0.0.1:3129", db = await openVerifiedIsolatedDatabase(base, "test-data/phase19-live");
try {
  const manifest = JSON.parse(await fs.readFile(path.join(output, "manifest.json"), "utf8"));
  const response = await fetch(`${base}/api/trips/${manifest.tripId}/plans`); assert.ok(response.ok);
  const plan = (await response.json()).plans.find((p) => p.isCurrent);
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ id: plan.id, events: plan.events, costs: plan.costs, places: plan.places, routes: plan.routeLegs, tickets: plan.tickets })).digest("hex");
  const tables = [];
  for (const name of ["appSettings", "evidenceFact", "planVersion", "trip", "tripRequest"]) {
    const rows = (await db[name].findMany()).map((r) => JSON.stringify(r)).sort();
    tables.push({ name, count: rows.length, hash: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex") });
  }
  const result = { checkedAt: new Date().toISOString(), version: plan.versionNumber, fingerprint, tables, integrity: await db.$queryRawUnsafe("PRAGMA integrity_check") };
  if (mode === "after") { const prior = JSON.parse(await fs.readFile(path.join(output, "persistence-before.json"), "utf8")); assert.equal(result.fingerprint, prior.fingerprint); assert.deepEqual(result.tables, prior.tables); }
  await fs.writeFile(path.join(output, `persistence-${mode}.json`), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
