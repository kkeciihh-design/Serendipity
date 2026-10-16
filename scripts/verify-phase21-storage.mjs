import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertTestDataPath } from "./test-data-safety.mjs";
const mode = process.argv[2]; assert.ok(["before", "after"].includes(mode));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase21-storage")); fs.mkdirSync(output, { recursive: true });
const before = mode === "after" ? JSON.parse(fs.readFileSync(path.join(output, "before.json"), "utf8")) : null;
const stores = {};
for (const [name, databasePath] of Object.entries({ formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"), phase20: assertTestDataPath(path.resolve("test-data/phase20-live/data/serendipity.db")) })) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const tables = ["AppSettings", "EvidenceFact", "PlanVersion", "Trip", "TripRequest", "ChecklistState"].map((table) => {
      const columns = before?.stores[name].tables.find((t) => t.name === table)?.columns ?? db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
      const rows = db.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${table}"`).all().map((row) => JSON.stringify(row)).sort();
      return { name: table, columns, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    });
    stores[name] = { databasePath, tables, migrationCount: db.prepare("SELECT count(*) as n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL").get().n, integrity: "ok" };
  } finally { db.close(); }
}
if (before) for (const name of Object.keys(stores)) { assert.deepEqual(stores[name].tables, before.stores[name].tables); assert.equal(stores[name].migrationCount, before.stores[name].migrationCount + (name === "formal" ? 1 : 0)); }
fs.writeFileSync(path.join(output, `${mode}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), stores }, null, 2));
console.log(`${mode}: formal and phase20 old columns/data intact; only hashes and counts recorded.`);
