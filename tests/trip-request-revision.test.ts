import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  type RequestSnapshot,
} from "../lib/trip-request";

const testDataDirectory = path.resolve("test-data", "unit-trip-request");
let trips: typeof import("../lib/trips");
let service: typeof import("../lib/trip-request-service");

function futureSnapshot(): RequestSnapshot {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const format = (date: Date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;

  return normalizeRequestSnapshot({
    ...emptyRequestSnapshot(),
    destination: "长沙",
    startDate: format(start),
    endDate: format(end),
    travelerCount: 2,
    budgetAmountCents: 150000,
    budgetScope: "total",
    fieldSources: {
      ...emptyRequestSnapshot().fieldSources,
      destination: "ai_extracted",
      startDate: "program_derived",
      endDate: "program_derived",
      travelerCount: "ai_extracted",
      budgetAmountCents: "ai_extracted",
      budgetScope: "ai_extracted",
    },
  });
}

beforeAll(async () => {
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.join(testDataDirectory, "data"), { recursive: true });
  process.env.SERENDIPITY_DATA_DIR = testDataDirectory;

  execFileSync(
    process.execPath,
    [
      path.resolve("node_modules", "prisma", "build", "index.js"),
      "migrate",
      "deploy",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUST_LOG: "info",
        DATABASE_URL: `file:${path
          .join(testDataDirectory, "data", "serendipity.db")
          .replaceAll("\\", "/")}`,
      },
      stdio: "pipe",
    },
  );

  trips = await import("../lib/trips");
  service = await import("../lib/trip-request-service");
});

afterAll(async () => {
  await Promise.all([
    trips.closeTripStore(),
    service.closeTripRequestStore(),
  ]);
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

describe("trip request revisions", () => {
  it("rejects a delayed same-value original request after a newer draft commits", async () => {
    const original = "旧原话：长沙两日游";
    const trip = await trips.createTrip({ originalRequest: original });
    const prisma = (globalThis as typeof globalThis & { serendipityPrisma: PrismaClient }).serendipityPrisma;
    const transact = prisma.$transaction.bind(prisma);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    const waitBeforeTransaction = async <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) => {
      entered();
      await gate;
      return transact(callback);
    };
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(waitBeforeTransaction as PrismaClient["$transaction"]);
    try {
      const old = trips.updateTrip(trip.id, { originalRequest: original, expectedRequestRevision: 1 });
      const oldRejected = expect(old).rejects.toMatchObject({ name: "TripRevisionConflictError" });
      await reached;
      await service.saveRequestDraft(trip.id, { originalRequest: "新原话：成都三日游", expectedRequestRevision: 1 });
      release();
      await oldRejected;
      const saved = await trips.getTrip(trip.id);
      expect(saved?.originalRequest).toBe("新原话：成都三日游");
      expect(saved?.request).toMatchObject({ originalRequest: saved?.originalRequest, requestRevision: 2 });
    } finally {
      release();
      transactionSpy.mockRestore();
    }
  });

  it("keeps same-revision no-ops and title-only edits independent of request revisions", async () => {
    const trip = await trips.createTrip({ originalRequest: "长沙两日游" });
    const unchanged = await trips.updateTrip(trip.id, { originalRequest: trip.originalRequest, expectedRequestRevision: 1 });
    expect(unchanged.request?.requestRevision).toBe(1);
    await service.saveRequestDraft(trip.id, { originalRequest: "成都三日游", expectedRequestRevision: 1 });
    const renamed = await trips.updateTrip(trip.id, { title: "旅行新标题", expectedRequestRevision: 1 });
    expect(renamed).toMatchObject({ title: "旅行新标题", originalRequest: "成都三日游", request: { originalRequest: "成都三日游", requestRevision: 2 } });
    await expect(trips.updateTrip(trip.id, { originalRequest: "成都三日游", expectedRequestRevision: 1 })).rejects.toMatchObject({ name: "TripRevisionConflictError" });
  });

  it("increments revisions, binds confirmation, and rejects stale writes", async () => {
    const original = "周末去长沙，两个人，预算 1500 元。";
    const trip = await trips.createTrip({ originalRequest: original });
    expect(trip.request?.requestRevision).toBe(1);

    const extracted = await service.saveExtractionResult({
      tripId: trip.id,
      expectedRequestRevision: 1,
      expectedOriginalRequest: original,
      snapshot: futureSnapshot(),
      questions: [],
      assumptions: [],
    });
    expect(extracted.requestRevision).toBe(2);
    expect(extracted.confirmedRevision).toBeNull();

    const confirmed = await service.confirmRequest(trip.id, {
      expectedRequestRevision: 2,
    });
    expect(confirmed.confirmedRevision).toBe(2);
    expect(confirmed.confirmedRequest?.destination).toBe("长沙");

    await expect(
      service.confirmRequest(trip.id, { expectedRequestRevision: 1 }),
    ).rejects.toMatchObject({ name: "TripRequestConflictError" });

    const changedOriginal = "周末去长沙，三个人，预算 2000 元。";
    const changed = await trips.updateTrip(trip.id, {
      originalRequest: changedOriginal,
      expectedRequestRevision: 2,
    });
    expect(changed.request?.requestRevision).toBe(3);
    expect(changed.request?.confirmedRevision).toBeNull();
    expect(changed.request?.extractedRequest).toBeNull();

    await expect(
      service.saveExtractionResult({
        tripId: trip.id,
        expectedRequestRevision: 2,
        expectedOriginalRequest: original,
        snapshot: futureSnapshot(),
        questions: [],
        assumptions: [],
      }),
    ).rejects.toMatchObject({ name: "TripRequestConflictError" });

    const afterStaleExtraction = await service.getTripRequestRecord(trip.id);
    expect(afterStaleExtraction.requestRevision).toBe(3);
    expect(afterStaleExtraction.extractedRequest).toBeNull();

    const edited = await service.saveRequestDraft(trip.id, {
      expectedRequestRevision: 3,
      request: {
        ...futureSnapshot(),
        travelerCount: 3,
        budgetAmountCents: 200000,
        fieldSources: {
          ...futureSnapshot().fieldSources,
          travelerCount: "user_confirmed",
          budgetAmountCents: "user_confirmed",
        },
      },
    });
    expect(edited.requestRevision).toBe(4);
    expect(edited.extractedRequest?.travelerCount).toBe(3);

    const reconfirmed = await service.confirmRequest(trip.id, {
      expectedRequestRevision: 4,
    });
    expect(reconfirmed.confirmedRevision).toBe(4);
  });
});
