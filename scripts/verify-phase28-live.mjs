import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { assertTestDataPath } from "./test-data-safety.mjs";
import { readInstanceState, readTravelBackup } from "./restore-core.mjs";
import { backupHash } from "./travel-backup-format.mjs";
const mode = process.argv[2];
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase28-live"));
fs.mkdirSync(output, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const save = (name, value) => fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), ...value }, null, 2));
function fingerprint(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const tables = Object.fromEntries(["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "AppSettings", "ChecklistState", "AdvisoryState", "ReplanCandidate", "ExecutionState", "ExportFile"].map((table) => {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify(r)).sort(); return [table, { count: rows.length, sha256: hash(JSON.stringify(rows)) }];
    }));
    return { tables, integrity: "ok", migrations: db.prepare('SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').get().n };
  } finally { db.close(); }
}
const formal = path.join(process.env.LOCALAPPDATA, "Serendipity/data/serendipity.db");
const sample = assertTestDataPath(path.resolve("test-data/phase27-live/data/serendipity.db"));
const live = assertTestDataPath(path.resolve("test-data/phase28-live/data/serendipity.db"));
if (["protect-before", "protect-after"].includes(mode)) {
  const value = { formal: fingerprint(formal), phase27: fingerprint(sample), securityKeyHash: hash(fs.readFileSync(path.resolve(formal, "../../security.key"))) };
  if (mode === "protect-after") {
    const before = JSON.parse(fs.readFileSync(path.join(output, "protect-before.json"), "utf8"));
    assert.deepEqual(value.formal.tables, before.formal.tables); assert.deepEqual(value.phase27, before.phase27); assert.equal(value.securityKeyHash, before.securityKeyHash);
    assert.equal(value.formal.migrations, 16);
  }
  save(mode, value); console.log(`${mode}: original travel/settings and security material fingerprints verified.`);
} else if (mode === "sample-backup") {
  const backup = readTravelBackup(sample); fs.writeFileSync(path.join(output, "sample-travel.json"), JSON.stringify(backup));
  save("sample-summary", { trips: backup.tables.Trip.map((t) => ({ id: t.id, title: t.title })), sha256: backupHash(backup) });
  console.log("Created travel-only backup from the existing isolated phase27 sample.");
} else if (["restart-before", "restart-after"].includes(mode)) {
  const value = { live: fingerprint(live), instance: readInstanceState(live), travelHash: backupHash(readTravelBackup(live)) };
  if (mode === "restart-after") {
    const before = JSON.parse(fs.readFileSync(path.join(output, "restart-before.json"), "utf8"));
    assert.deepEqual(value.live, before.live); assert.deepEqual(JSON.parse(JSON.stringify(value.instance)), before.instance); assert.equal(value.travelHash, before.travelHash);
  }
  save(mode, value); console.log(`${mode}: travel state and persistent generation verified.`);
} else throw new Error("Unknown verification mode.");
