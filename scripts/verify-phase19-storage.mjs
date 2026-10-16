import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertTestDataPath } from "./test-data-safety.mjs";

const mode = process.argv[2];
assert.ok(["before", "after"].includes(mode));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase19-storage"));
fs.mkdirSync(output, { recursive: true });
const sources = {
  formal: path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db"),
  phase18Demo: assertTestDataPath(path.resolve("test-data/phase18-live/data/serendipity.db")),
};
const result = { checkedAt: new Date().toISOString(), stores: {} };
for (const [name, databasePath] of Object.entries(sources)) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const migrations = db.prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name").all();
    assert.equal(migrations.length, 10, "Expected the already-migrated phase16R schema; do not implicitly upgrade real data.");
    const tables = ["AppSettings", "EvidenceFact", "PlanVersion", "Trip", "TripRequest"].map((table) => {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((row) => JSON.stringify(row)).sort();
      return { name: table, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    });
    result.stores[name] = { databasePath, migrations: migrations.map((row) => row.migration_name), tables, integrity: "ok" };
  } finally { db.close(); }
}
if (mode === "after") assert.deepEqual(result.stores, JSON.parse(fs.readFileSync(path.join(output, "before.json"), "utf8")).stores);
fs.writeFileSync(path.join(output, `${mode}.json`), JSON.stringify(result, null, 2));
console.log(`${mode}: both databases intact, ten existing migrations, only table counts and hashes recorded${mode === "after" ? "; all fingerprints unchanged" : ""}.`);
