import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("adds a stale-by-default evaluator marker without rewriting existing evidence", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec('CREATE TABLE "EvidenceFact" ("id" TEXT PRIMARY KEY, "field" TEXT, "status" TEXT, "contentQuote" TEXT, "retrievedAt" TEXT)');
    database.prepare('INSERT INTO "EvidenceFact" VALUES (?, ?, ?, ?, ?)').run("old-fact", "opening_hours", "verified", "Opening hours daily 09:00–17:00", "2026-10-01T00:00:00Z");
    const before = database.prepare('SELECT * FROM "EvidenceFact"').get();
    database.exec(fs.readFileSync(path.resolve("prisma/migrations/20261015080000_add_evidence_evaluation_version/migration.sql"), "utf8"));
    expect(database.prepare('SELECT * FROM "EvidenceFact"').get()).toEqual({ ...before, evaluationVersion: 0 });
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    database.close();
  }
});
