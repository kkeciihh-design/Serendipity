import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertTestDataPath } from "./test-data-safety.mjs";

const mode = process.argv[2];
assert.ok(["before", "after"].includes(mode));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase29"));
fs.mkdirSync(output, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fingerprint(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map((r) => JSON.stringify(r)).sort();
      return [name, { count: rows.length, hash: hash(JSON.stringify(rows)) }];
    }));
  } finally { db.close(); }
}
const data = path.join(process.env.LOCALAPPDATA, "Serendipity");
const result = { formal: fingerprint(path.join(data, "data/serendipity.db")), demo28: fingerprint(assertTestDataPath(path.resolve("test-data/phase28-live/data/serendipity.db"))), securityKeyHash: hash(fs.readFileSync(path.join(data, "security.key"))) };
if (mode === "after") assert.deepEqual(result, JSON.parse(fs.readFileSync(path.join(output, "protection-before.json"))).fingerprints);
fs.writeFileSync(path.join(output, `protection-${mode}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), fingerprints: result }, null, 2));
console.log(`PASS ${mode}: formal and existing demo all-table fingerprints; security key hash; SQLite integrity`);
