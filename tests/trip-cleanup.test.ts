import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";

let database: ReturnType<typeof isolatedDatabase>;
let db: PrismaClient;
let trips: typeof import("../lib/trips");

async function createTrip(options: {
  title: string;
  request: string;
  generated: boolean;
  updatedAt: Date;
}) {
  const trip = await db.trip.create({
    data: {
      title: options.title,
      originalRequest: options.request,
      status: options.generated ? "planned" : "draft",
      updatedAt: options.updatedAt,
      request: { create: { originalRequest: options.request, requestRevision: 1 } },
    },
  });
  if (!options.generated) return trip;
  const plan = await db.planVersion.create({
    data: {
      tripId: trip.id,
      versionNumber: 1,
      requestRevision: 1,
      requestSnapshot: "{}",
      events: "[]",
      costs: "[]",
      places: "[]",
      routeLegs: "[]",
      tickets: "[]",
      pendingItems: "[]",
      validationResults: JSON.stringify({ errors: [], warnings: [] }),
      requirementUpToDate: true,
      updatedAt: options.updatedAt,
    },
  });
  return db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
}

beforeAll(async () => {
  database = isolatedDatabase("unit-trip-cleanup");
  db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips");
});

afterAll(async () => {
  await db.$disconnect();
  await trips.closeTripStore();
  database.cleanup();
});

it("keeps the newest generated duplicate and removes blank drafts", async () => {
  const duplicate = "想去泉州玩三天";
  await createTrip({ title: duplicate, request: duplicate, generated: true, updatedAt: new Date("2026-10-01T08:00:00Z") });
  const keeper = await createTrip({ title: duplicate, request: duplicate, generated: true, updatedAt: new Date("2026-10-02T08:00:00Z") });
  await createTrip({ title: duplicate, request: duplicate, generated: false, updatedAt: new Date("2026-10-03T08:00:00Z") });
  const unique = await createTrip({ title: "桂林四日", request: "想去桂林看山水", generated: true, updatedAt: new Date("2026-10-04T08:00:00Z") });
  await createTrip({ title: "空白灵感", request: "还没想好", generated: false, updatedAt: new Date("2026-10-05T08:00:00Z") });

  const result = await trips.cleanupDuplicateTrips();
  expect(result.deletedCount).toBe(3);
  const remaining = await trips.listTrips();
  expect(remaining.map((trip) => trip.id).sort()).toEqual([keeper.id, unique.id].sort());
});
