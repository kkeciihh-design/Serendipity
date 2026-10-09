import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDirectory = path.resolve("test-data", "trip-request-backfill");
const databasePath = path.join(testDirectory, "serendipity.db");
let database: DatabaseSync;

function migrationSql(name: string) {
  return fs.readFileSync(
    path.resolve("prisma", "migrations", name, "migration.sql"),
    "utf8",
  );
}

beforeAll(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
  fs.mkdirSync(testDirectory, { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec(migrationSql("20261008173000_init_trip"));
  database
    .prepare(
      `INSERT INTO "Trip" ("id", "title", "originalRequest", "status", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "existing-trip",
      "既有草稿",
      "周末去长沙",
      "draft",
      new Date().toISOString(),
      new Date().toISOString(),
    );
  database.exec(migrationSql("20261008210000_add_app_settings"));
  database.exec(migrationSql("20261009110000_add_trip_request"));
});

afterAll(() => {
  database.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

describe("TripRequest migration backfill", () => {
  it("creates an unconfirmed revision 1 for an existing draft", () => {
    const row = database
      .prepare(
        `SELECT "requestRevision", "confirmedRevision", "confirmedRequest", "originalRequest"
         FROM "TripRequest" WHERE "tripId" = ?`,
      )
      .get("existing-trip") as {
      requestRevision: number;
      confirmedRevision: number | null;
      confirmedRequest: string | null;
      originalRequest: string;
    };

    expect(row.requestRevision).toBe(1);
    expect(row.confirmedRevision).toBeNull();
    expect(row.confirmedRequest).toBeNull();
    expect(row.originalRequest).toBe("周末去长沙");
  });
});
