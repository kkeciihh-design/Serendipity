import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertTestDataPath } from "./test-data-safety.mjs";

const mode = process.argv[2]; assert.ok(["before", "after"].includes(mode));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase20-storage")); fs.mkdirSync(output, { recursive: true });
const stores = {};
for (const [name, databasePath] of Object.entries({ formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"),
  phase17: assertTestDataPath(path.resolve("test-data/phase17-live/data/serendipity.db")), phase18: assertTestDataPath(path.resolve("test-data/phase18-live/data/serendipity.db")), phase19: assertTestDataPath(path.resolve("test-data/phase19-live/data/serendipity.db")) })) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const tables = ["AppSettings", "EvidenceFact", "PlanVersion", "Trip", "TripRequest"].map((table) => {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((row) => JSON.stringify(row)).sort();
      return { name: table, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    });
    const migrations = db.prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name").all().map((row) => row.migration_name);
    stores[name] = { databasePath, tables, migrations, integrity: "ok" };
  } finally { db.close(); }
}
if (mode === "after") {
  const before = JSON.parse(fs.readFileSync(path.join(output, "before.json"), "utf8")).stores;
  for (const name of Object.keys(stores)) { assert.deepEqual(stores[name].tables, before[name].tables); assert.equal(stores[name].migrations.length, name === "formal" ? 11 : 10); }
}
fs.writeFileSync(path.join(output, `${mode}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), stores }, null, 2));
console.log(`${mode}: formal and three previous demos are intact; only counts and hashes recorded${mode === "after" ? "; all old tables unchanged, formal migration 11 applied" : ""}.`);
