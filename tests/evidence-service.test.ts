import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectedEvidence } from "../lib/evidence-source";

const testDataDirectory = path.resolve("test-data", "unit-evidence");
let trips: typeof import("../lib/trips");
let evidenceService: typeof import("../lib/evidence-service");
let planService: typeof import("../lib/plan-service");
let settingsService: typeof import("../lib/settings");
let PrismaClient: typeof import("@prisma/client").PrismaClient;

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function collectedResult(input: {
  status: "verified" | "unverified";
  extractedValue: string;
  conflictReason?: string;
  sourcePublishedAt?: Date | null;
  sourceDateStatus?: string;
}): CollectedEvidence {
  const common = {
    sourceTitle: "Example Museum Visit",
    sourceUrl: "https://www.example.com/visit",
    sourcePublisher: "www.example.com",
    sourcePublishedAt: input.sourcePublishedAt ?? null,
    sourceDateStatus: input.sourceDateStatus ?? "undated",
    extractedValue: input.extractedValue,
  };
  if (input.status === "verified") {
    return {
      ...common,
      status: "verified" as const,
      contentQuote: "Open Hours From Tuesday to Sunday, 9:00—17:00.",
      conflictReason: null,
    };
  }
  return {
    ...common,
    status: "unverified" as const,
    contentQuote: "",
    conflictReason: input.conflictReason ?? "来源内容未能核验。",
  };
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
  evidenceService = await import("../lib/evidence-service");
  planService = await import("../lib/plan-service");
  settingsService = await import("../lib/settings");
  ({ PrismaClient } = await import("@prisma/client"));
});

afterAll(async () => {
  await trips.closeTripStore();
  await evidenceService.closeEvidenceStore();
  await planService.closePlanStore();
  await (await import("../lib/settings")).closeSettingsStore();
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

describe("evidence persistence and conflict handling", () => {
  it("stores field evidence, detects conflicts, and preserves old data on refresh failure", async () => {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: `file:${path
            .join(testDataDirectory, "data", "serendipity.db")
            .replaceAll("\\", "/")}`,
        },
      },
    });
    const searchConfiguration = {
      provider: "duckduckgo" as const,
      language: "en" as const,
    };
    await settingsService.saveSearchConfiguration(
      searchConfiguration,
      settingsService.createSearchTestToken(searchConfiguration),
    );
    expect((await settingsService.getSafeSettings()).search).toMatchObject({
      provider: "duckduckgo",
      language: "en",
      status: "connected",
    });

    const trip = await trips.createTrip({
      originalRequest: "阶段10来源核验测试。",
    });
    const eventDate = futureDate(30);
    const secondDate = futureDate(31);
    const planEvent = (
      id: string,
      dayNumber: number,
      date: string,
      startTime: string,
      endTime: string,
      type: string,
      title: string,
    ) => ({
      id,
      dayNumber,
      date,
      startTime,
      endTime,
      type,
      title,
      locationName: type === "preparation" ? null : "Example City",
      suggestedDurationSeconds: 3600,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: null,
      status: "suggested",
      locked: false,
      endDate: date,
    });
    const events = [
      planEvent("d1-preparation", 1, eventDate, "07:30", "07:50", "preparation", "当日准备"),
      planEvent("d1-breakfast", 1, eventDate, "08:00", "08:45", "meal", "早餐"),
      planEvent("departure", 1, eventDate, "09:00", "10:00", "departure_transport", "去程"),
      planEvent("museum", 1, eventDate, "10:30", "12:30", "activity", "Example Museum"),
      planEvent("d1-lunch", 1, eventDate, "12:40", "13:30", "meal", "午餐"),
      planEvent("d1-rest", 1, eventDate, "14:00", "14:30", "rest", "休息"),
      planEvent("d1-hotel", 1, eventDate, "20:00", "22:00", "accommodation", "住宿区域"),
      planEvent("d2-preparation", 2, secondDate, "07:30", "07:50", "preparation", "返程前准备"),
      planEvent("d2-breakfast", 2, secondDate, "08:00", "08:45", "meal", "早餐"),
      planEvent("d2-activity", 2, secondDate, "10:00", "12:00", "activity", "城市漫步"),
      planEvent("d2-lunch", 2, secondDate, "12:30", "13:30", "meal", "午餐"),
      planEvent("d2-rest", 2, secondDate, "14:00", "14:30", "rest", "休息"),
      planEvent("return", 2, secondDate, "17:00", "19:00", "return_transport", "返程"),
    ];
    const plan = await prisma.planVersion.create({
      data: {
        tripId: trip.id,
        versionNumber: 1,
        requestRevision: 1,
        requestSnapshot: JSON.stringify({
          destination: "长沙",
          startDate: eventDate,
          endDate: secondDate,
          travelerCount: 2,
          budgetAmountCents: 100000,
          budgetScope: "total",
          pace: "balanced",
          interests: [],
          accommodation: null,
          constraints: [],
          fieldSources: {
            destination: "user_confirmed",
            startDate: "program_derived",
            endDate: "program_derived",
            travelerCount: "user_confirmed",
            budgetAmountCents: "user_confirmed",
            budgetScope: "user_confirmed",
            pace: "user_confirmed",
            interests: "user_confirmed",
            accommodation: "unspecified",
            constraints: "unspecified",
          },
        }),
        events: JSON.stringify(events),
        costs: JSON.stringify([
          {
            id: "cost-museum",
            linkedEventId: "museum",
            category: "ticket",
            currency: "CNY",
            unit: "one_time",
            unitAmountCents: null,
            unitAmountMaxCents: null,
            quantity: null,
            certainty: "pending_confirmation",
            paymentStatus: "not_paid",
            source: "ai_draft",
            eventRemoved: false,
            note: null,
          },
        ]),
        pendingItems: JSON.stringify([
          {
            id: "opening-hours",
            category: "opening_hours",
            title: "确认开放时间",
            reason: "测试计划需要待确认项。",
            requiredBefore: eventDate,
          },
        ]),
        validationResults: JSON.stringify({
          status: "valid",
          errors: [],
          warnings: [],
        }),
        requirementUpToDate: true,
      },
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { currentPlanVersionId: plan.id, status: "planned" },
    });

    const baseInput = {
      tripId: trip.id,
      expectedPlanVersion: 1,
      eventId: "museum",
      field: "opening_hours",
      query: "Example Museum open hours",
      officialHost: "example.com",
    };

    const verified = await evidenceService.verifyEvidenceFact(baseInput, {
      collectEvidence: async () =>
        collectedResult({
          status: "verified",
          extractedValue: "9:00—17:00",
        }),
    });
    expect(verified.status).toBe("verified");
    expect(verified.effectiveStatus).toBe("verified");
    expect(verified.sourceUrl).toBe("https://www.example.com/visit");

    await evidenceService.closeEvidenceStore();
    const reopenedFacts = await evidenceService.listEvidenceFacts(trip.id);
    expect(
      reopenedFacts.find(
        (fact) =>
          fact.targetId === "museum" && fact.field === "opening_hours",
      ),
    ).toMatchObject({
      status: "verified",
      sourceUrl: "https://www.example.com/visit",
    });

    const summaryOnly = await evidenceService.verifyEvidenceFact(
      {
        ...baseInput,
        field: "price",
        query: "Example Museum ticket price",
      },
      {
        collectEvidence: async () =>
          collectedResult({
            status: "unverified",
            extractedValue: "",
            conflictReason: "搜索摘要不能作为核验依据。",
          }),
      },
    );
    expect(summaryOnly.status).toBe("unverified");
    expect(summaryOnly.effectiveStatus).toBe("pending");

    const conflict = await evidenceService.verifyEvidenceFact(
      { ...baseInput, field: "opening_hours" },
      {
        collectEvidence: async () =>
          collectedResult({
            status: "verified",
            extractedValue: "10:00—18:00",
          }),
      },
    );
    expect(conflict.status).toBe("conflict");
    expect(conflict.effectiveStatus).toBe("conflict");
    expect(conflict.conflictReason).toContain("原 9:00—17:00");

    const reservationVerified = await evidenceService.verifyEvidenceFact(
      { ...baseInput, field: "reservation", query: "Example Museum booking" },
      {
        collectEvidence: async () =>
          collectedResult({
            status: "verified",
            extractedValue: "required",
          }),
      },
    );
    expect(reservationVerified.effectiveStatus).toBe("verified");

    const failedRefresh = await evidenceService.verifyEvidenceFact(
      { ...baseInput, field: "reservation", query: "Example Museum booking" },
      {
        collectEvidence: async () => {
          throw new Error("网络超时");
        },
      },
    );
    expect(failedRefresh.status).toBe("verified");
    expect(failedRefresh.lastRefreshStatus).toBe("failed");
    expect(failedRefresh.lastRefreshError).toBe("网络超时");
    expect(failedRefresh.effectiveStatus).toBe("stale");
    expect(failedRefresh.sourceUrl).toBe("https://www.example.com/visit");

    const facts = await evidenceService.listEvidenceFacts(trip.id);
    expect(facts).toHaveLength(3);
    expect(
      facts.filter((fact) => fact.effectiveStatus === "verified"),
    ).toHaveLength(0);

    await expect(
      evidenceService.verifyEvidenceFact(
        { ...baseInput, field: "location", query: "Example Museum address" },
        {
          collectEvidence: async () => {
            throw new Error("网络失败");
          },
        },
      ),
    ).rejects.toMatchObject({ name: "EvidenceSourceError" });

    const noFakeFact = await evidenceService.listEvidenceFacts(trip.id);
    expect(noFakeFact.some((fact) => fact.field === "location")).toBe(false);

    const beforeCostEdit = await planService.getPlanVersion(trip.id, 1);
    expect(beforeCostEdit.costs).toHaveLength(1);
    expect(beforeCostEdit.costs[0]).toMatchObject({
      id: "cost-museum",
      linkedEventId: "museum",
    });

    const edited = await planService.savePlanCostEdit({
      tripId: trip.id,
      expectedPlanVersion: 1,
      edit: {
        costId: "cost-museum",
        unit: "one_time",
        unitAmountCents: 1000,
        unitAmountMaxCents: null,
        quantity: null,
        paymentStatus: "not_paid",
      },
    });
    const inheritedFacts = await evidenceService.listEvidenceFacts(trip.id);
    expect(edited.versionNumber).toBe(2);
    expect(inheritedFacts).toHaveLength(6);
    expect(
      inheritedFacts.find(
        (fact) =>
          fact.planVersionId === edited.id &&
          fact.field === "opening_hours" &&
          fact.effectiveStatus === "conflict",
      ),
    ).toBeTruthy();

    await prisma.trip.delete({ where: { id: trip.id } });
    await prisma.$disconnect();
  });
});
