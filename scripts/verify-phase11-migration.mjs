import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const [phase, input] = process.argv.slice(2);
if (!["before", "after"].includes(phase) || !input || !path.isAbsolute(input)) throw new Error("Usage: node scripts/verify-phase11-migration.mjs before|after ABSOLUTE_DATABASE_PATH");
const database = path.resolve(input);
const output = path.resolve("test-data/phase11-evidence");
fs.mkdirSync(output, { recursive: true });
const beforeFile = path.join(output, "migration-before.json");
const before = phase === "after" ? JSON.parse(fs.readFileSync(beforeFile, "utf8")) : null;
if (before) assert.equal(before.database, database);
const reader = new DatabaseSync(database, { readOnly: true });
try {
  assert.equal(Object.values(reader.prepare("PRAGMA integrity_check").get())[0], "ok");
  const result = { database, checkedAt: new Date().toISOString(), integrity: "ok", tables: [] };
  for (const name of ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "AppSettings"]) {
    const columns = before?.tables.find((table) => table.name === name).columns ?? reader.prepare(`PRAGMA table_info("${name}")`).all().map((column) => column.name);
    const rows = reader.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM "${name}" ORDER BY id`).all();
    const hash = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    result.tables.push({ name, columns, count: rows.length, hash });
    if (before) assert.equal(hash, before.tables.find((table) => table.name === name).hash, `${name} changed during migration`);
  }
  fs.writeFileSync(path.join(output, `migration-${phase}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ phase, integrity: result.integrity, oldContentUnchanged: Boolean(before), tables: result.tables.map(({ name, count }) => ({ name, count })) }));
} finally { reader.close(); }
