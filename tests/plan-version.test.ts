import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  emptyRequestSnapshot,
  normalizeRequestSnapshot,
  type RequestSnapshot,
} from "../lib/trip-request";
import { tripDates, validatePlan, type PlanEvent } from "../lib/plan";

const testDataDirectory = path.resolve("test-data", "unit-plan-version");
let trips: typeof import("../lib/trips");
let requestService: typeof import("../lib/trip-request-service");
let planService: typeof import("../lib/plan-service");
let planGeneration: typeof import("../lib/plan-generation");
let settings: typeof import("../lib/settings");

function formatDate(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function snapshotWith(input: Partial<RequestSnapshot> = {}): RequestSnapshot {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return normalizeRequestSnapshot({
    ...emptyRequestSnapshot(),
    destination: "长沙",
    startDate: formatDate(start),
    endDate: formatDate(end),
    travelerCount: 2,
    budgetAmountCents: 150000,
    budgetScope: "total",
    pace: "balanced",
    ...input,
    fieldSources: {
      ...emptyRequestSnapshot().fieldSources,
      destination: "user_confirmed",
      startDate: "program_derived",
      endDate: "program_derived",
      travelerCount: "user_confirmed",
      budgetAmountCents: "user_confirmed",
      budgetScope: "user_confirmed",
      pace: "user_confirmed",
      ...(input.fieldSources ?? {}),
    },
  });
}

function event(input: Partial<PlanEvent> & Pick<PlanEvent, "id" | "dayNumber" | "date" | "startTime" | "endTime" | "type" | "title">): PlanEvent {
  return {
    locationName: "市中心区域",
    suggestedDurationSeconds: 3600,
    costDraftCents: null,
    costStatus: "estimated",
    note: null,
    ...input,
  };
}

function completePlan(snapshot: RequestSnapshot) {
  const dates = tripDates(snapshot);
  const events: PlanEvent[] = [];
  dates.forEach((date, index) => {
    const dayNumber = index + 1;
    events.push(
      event({
        id: `d${dayNumber}-preparation`,
        dayNumber,
        date,
        startTime: "07:30",
        endTime: "07:50",
        type: "preparation",
        title: "当日准备",
      }),
    );
    events.push(
      event({
        id: `d${dayNumber}-breakfast`,
        dayNumber,
        date,
        startTime: "08:00",
        endTime: "08:45",
        type: "meal",
        title: "早餐",
      }),
    );
    events.push(
      event({
        id: `d${dayNumber}-activity`,
        dayNumber,
        date,
        startTime: "10:00",
        endTime: "12:00",
        type: "activity",
        title: "城市漫步",
      }),
    );
    events.push(
      event({
        id: `d${dayNumber}-lunch`,
        dayNumber,
        date,
        startTime: "12:30",
        endTime: "13:30",
        type: "meal",
        title: "午餐",
      }),
    );
    events.push(
      event({
        id: `d${dayNumber}-rest`,
        dayNumber,
        date,
        startTime: "14:00",
        endTime: "14:30",
        type: "rest",
        title: "休息",
      }),
    );
    if (dayNumber < dates.length) {
      events.push(
        event({
          id: `d${dayNumber}-hotel`,
          dayNumber,
          date,
          startTime: "20:00",
          endTime: "22:00",
          type: "accommodation",
          title: "住宿区域",
        }),
      );
    }
  });
  events.push(
    event({
      id: "departure",
      dayNumber: 1,
      date: dates[0],
      startTime: "06:30",
      endTime: "07:30",
      type: "departure_transport",
      title: "去程",
      locationName: "出发站",
    }),
  );
  events.push(
    event({
      id: "return",
      dayNumber: dates.length,
      date: dates[dates.length - 1],
      startTime: "17:00",
      endTime: "18:30",
      type: "return_transport",
      title: "返程",
      locationName: "返程站",
    }),
  );

  return {
    events,
    pendingItems: [
      {
        id: "ticket",
        category: "transport_ticket" as const,
        title: "确认去返程车票",
        reason: "本阶段没有实时余票依据。",
        requiredBefore: dates[0],
      },
    ],
  };
}

function saveCurrentPlan(capture: Awaited<ReturnType<typeof planService.getPlanGenerationContext>>) {
  const plan = completePlan(capture.requestSnapshot);
  const validation = validatePlan(plan, capture.requestSnapshot);
  return planService.savePlanVersion({
    capture,
    plan,
    validationResults: validation,
  });
}

async function changeAndConfirm(
  tripId: string,
  revision: number,
  snapshot: RequestSnapshot,
) {
  const edited = await requestService.saveRequestDraft(tripId, {
    expectedRequestRevision: revision,
    request: snapshot,
  });
  return requestService.confirmRequest(tripId, {
    expectedRequestRevision: edited.requestRevision,
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
  requestService = await import("../lib/trip-request-service");
  planService = await import("../lib/plan-service");
  planGeneration = await import("../lib/plan-generation");
  settings = await import("../lib/settings");
});

afterAll(async () => {
  await Promise.all([
    trips.closeTripStore(),
    requestService.closeTripRequestStore(),
    planService.closePlanStore(),
    settings.closeSettingsStore(),
  ]);
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

describe("plan versions", () => {
  it("preserves snapshots and rejects stale request or plan results", async () => {
    const original = "阶段06验收：两天长沙基础行程。";
    const trip = await trips.createTrip({ originalRequest: original });
    const initialSnapshot = snapshotWith();
    await requestService.saveExtractionResult({
      tripId: trip.id,
      expectedRequestRevision: 1,
      expectedOriginalRequest: original,
      snapshot: initialSnapshot,
      questions: [],
      assumptions: [],
    });
    await requestService.confirmRequest(trip.id, {
      expectedRequestRevision: 2,
    });

    let capture = await planService.getPlanGenerationContext(trip.id, 2);
    const first = await saveCurrentPlan(capture);
    expect(first.versionNumber).toBe(1);
    expect(first.requestRevision).toBe(2);
    expect(first.requestSnapshot.destination).toBe("长沙");

    await planService.closePlanStore();
    await trips.closeTripStore();
    const reopenedTrip = await trips.getTrip(trip.id);
    const reopenedPlans = await planService.listPlanVersions(trip.id);
    expect(reopenedTrip?.id).toBe(trip.id);
    expect(reopenedPlans[0].versionNumber).toBe(1);
    expect(reopenedPlans[0].requestSnapshot.destination).toBe("长沙");

    const changedDestination = snapshotWith({ destination: "株洲" });
    const destinationConfirmed = await changeAndConfirm(
      trip.id,
      2,
      changedDestination,
    );
    await expect(saveCurrentPlan(capture)).rejects.toMatchObject({
      name: "PlanConflictError",
    });

    capture = await planService.getPlanGenerationContext(
      trip.id,
      destinationConfirmed.requestRevision,
    );
    const second = await saveCurrentPlan(capture);
    expect(second.versionNumber).toBe(2);
    expect(second.requestSnapshot.destination).toBe("株洲");

    const shiftedStart = new Date(`${initialSnapshot.startDate}T00:00:00`);
    shiftedStart.setDate(shiftedStart.getDate() + 2);
    const shiftedEnd = new Date(shiftedStart);
    shiftedEnd.setDate(shiftedEnd.getDate() + 1);
    const changedDates = snapshotWith({
      ...changedDestination,
      startDate: formatDate(shiftedStart),
      endDate: formatDate(shiftedEnd),
    });
    const dateCapture = await planService.getPlanGenerationContext(
      trip.id,
      destinationConfirmed.requestRevision,
    );
    const dateConfirmed = await changeAndConfirm(
      trip.id,
      destinationConfirmed.requestRevision,
      changedDates,
    );
    await expect(saveCurrentPlan(dateCapture)).rejects.toMatchObject({
      name: "PlanConflictError",
    });

    capture = await planService.getPlanGenerationContext(
      trip.id,
      dateConfirmed.requestRevision,
    );
    const third = await saveCurrentPlan(capture);
    expect(third.versionNumber).toBe(3);

    const changedTravelers = snapshotWith({
      ...changedDates,
      travelerCount: 3,
    });
    const travelerCapture = await planService.getPlanGenerationContext(
      trip.id,
      dateConfirmed.requestRevision,
    );
    const travelerConfirmed = await changeAndConfirm(
      trip.id,
      dateConfirmed.requestRevision,
      changedTravelers,
    );
    await expect(saveCurrentPlan(travelerCapture)).rejects.toMatchObject({
      name: "PlanConflictError",
    });

    capture = await planService.getPlanGenerationContext(
      trip.id,
      travelerConfirmed.requestRevision,
    );
    const fourth = await saveCurrentPlan(capture);
    expect(fourth.versionNumber).toBe(4);

    const concurrentCapture = await planService.getPlanGenerationContext(
      trip.id,
      travelerConfirmed.requestRevision,
    );
    const fifth = await saveCurrentPlan(concurrentCapture);
    expect(fifth.versionNumber).toBe(5);
    await expect(saveCurrentPlan(concurrentCapture)).rejects.toMatchObject({
      name: "PlanConflictError",
    });

    const history = await planService.listPlanVersions(trip.id);
    expect(history.map((plan) => plan.versionNumber)).toEqual([5, 4, 3, 2, 1]);
    expect(history[4].requestSnapshot.destination).toBe("长沙");
    expect(history[0].requestSnapshot.destination).toBe("株洲");
    expect(history[0].requestSnapshot.travelerCount).toBe(3);
    expect(history[0].isCurrent).toBe(true);
    expect(history[1].isCurrent).toBe(false);

    const staleConfirmed = await changeAndConfirm(
      trip.id,
      travelerConfirmed.requestRevision,
      snapshotWith({ destination: "湘潭" }),
    );
    const stalePlans = await planService.listPlanVersions(trip.id);
    expect(stalePlans[0].requirementUpToDate).toBe(false);
    expect(stalePlans[0].requestSnapshot.destination).toBe("株洲");
    expect(staleConfirmed.requestRevision).toBe(6);

    await expect(
      planService.savePlanVersion({
        capture: concurrentCapture,
        plan: completePlan(concurrentCapture.requestSnapshot),
        validationResults: validatePlan(
          completePlan(concurrentCapture.requestSnapshot),
          concurrentCapture.requestSnapshot,
        ),
      }),
    ).rejects.toMatchObject({ name: "PlanConflictError" });
  });

  it("prevents duplicate generation, cancellation writes, and invalid output writes", async () => {
    const original = "阶段06取消测试：两天长沙基础行程。";
    const trip = await trips.createTrip({ originalRequest: original });
    const snapshot = snapshotWith();
    await requestService.saveExtractionResult({
      tripId: trip.id,
      expectedRequestRevision: 1,
      expectedOriginalRequest: original,
      snapshot,
      questions: [],
      assumptions: [],
    });
    const confirmed = await requestService.confirmRequest(trip.id, {
      expectedRequestRevision: 2,
    });
    const capture = await planService.getPlanGenerationContext(
      trip.id,
      confirmed.requestRevision,
    );
    const firstPlan = await saveCurrentPlan(capture);
    expect(firstPlan.versionNumber).toBe(1);

    const configuration = {
      provider: "openai-responses" as const,
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
      apiKey: "test-key-123456",
    };
    await settings.saveAIConfiguration(
      configuration,
      settings.createTestToken(configuration),
    );

    const nextCapture = await planService.getPlanGenerationContext(
      trip.id,
      confirmed.requestRevision,
    );
    let releaseCompletion: (() => void) | undefined;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const controller = new AbortController();
    const generation = planGeneration.generatePlanVersion({
      tripId: trip.id,
      expectedRequestRevision: confirmed.requestRevision,
      expectedPlanVersion: 1,
      abortSignal: controller.signal,
      completion: async () => {
        markStarted?.();
        await completionGate;
        return {
          ok: true,
          content: JSON.stringify(completePlan(nextCapture.requestSnapshot)),
        };
      },
    });

    await started;
    await expect(
      planGeneration.generatePlanVersion({
        tripId: trip.id,
        expectedRequestRevision: confirmed.requestRevision,
        expectedPlanVersion: 1,
        completion: async () => {
          throw new Error("should not run");
        },
      }),
    ).rejects.toMatchObject({ name: "PlanConflictError" });

    controller.abort();
    releaseCompletion?.();
    await expect(generation).rejects.toMatchObject({
      name: "PlanConflictError",
    });
    expect((await planService.listPlanVersions(trip.id)).length).toBe(1);

    await expect(
      planGeneration.generatePlanVersion({
        tripId: trip.id,
        expectedRequestRevision: confirmed.requestRevision,
        expectedPlanVersion: 1,
        completion: async () => ({ ok: true, content: "not-json" }),
      }),
    ).rejects.toMatchObject({
      name: "PlanGenerationError",
      category: "invalid_output",
    });
    expect((await planService.listPlanVersions(trip.id)).length).toBe(1);
  });

  it("edits current plans into new versions while preserving ids, snapshots, and locks", async () => {
    const original = "阶段08验收：两天长沙每日时间轴。";
    const trip = await trips.createTrip({ originalRequest: original });
    const snapshot = snapshotWith();
    await requestService.saveExtractionResult({
      tripId: trip.id,
      expectedRequestRevision: 1,
      expectedOriginalRequest: original,
      snapshot,
      questions: [],
      assumptions: [],
    });
    const confirmed = await requestService.confirmRequest(trip.id, {
      expectedRequestRevision: 2,
    });
    const capture = await planService.getPlanGenerationContext(
      trip.id,
      confirmed.requestRevision,
    );

    const initialPlan = completePlan(capture.requestSnapshot);
    initialPlan.events.push(
      event({
        id: "d1-optional-activity",
        dayNumber: 1,
        date: capture.requestSnapshot.startDate!,
        startTime: "15:00",
        endTime: "16:00",
        type: "activity",
        title: "可选城市展览",
        suggestedDurationSeconds: 3600,
      }),
    );
    const initialValidation = validatePlan(
      initialPlan,
      capture.requestSnapshot,
    );
    const first = await planService.savePlanVersion({
      capture,
      plan: initialPlan,
      validationResults: initialValidation,
    });
    const firstIds = first.events.map((event) => event.id);

    const locked = await planService.savePlanEventEdit({
      tripId: trip.id,
      expectedPlanVersion: first.versionNumber,
      edit: {
        eventId: "d1-optional-activity",
        startTime: "15:00",
        durationMinutes: 60,
        note: "展览门票已买",
        locked: true,
        status: "confirmed",
        remove: false,
      },
    });
    expect(locked.versionNumber).toBe(2);
    expect(locked.requestRevision).toBe(first.requestRevision);
    expect(locked.requestSnapshot.destination).toBe("长沙");
    expect(locked.events.map((event) => event.id)).toEqual(firstIds);
    expect(
      locked.events.find((event) => event.id === "d1-optional-activity"),
    ).toMatchObject({
      note: "展览门票已买",
      locked: true,
      status: "confirmed",
    });

    await expect(
      planService.savePlanEventEdit({
        tripId: trip.id,
        expectedPlanVersion: locked.versionNumber,
        edit: {
          eventId: "d1-optional-activity",
          startTime: "15:00",
          durationMinutes: 60,
          note: "展览门票已买",
          locked: true,
          status: "confirmed",
          remove: true,
        },
      }),
    ).rejects.toMatchObject({ name: "PlanConflictError" });

    const unlocked = await planService.savePlanEventEdit({
      tripId: trip.id,
      expectedPlanVersion: locked.versionNumber,
      edit: {
        eventId: "d1-optional-activity",
        startTime: "15:00",
        durationMinutes: 60,
        note: "展览门票已买",
        locked: false,
        status: "confirmed",
        remove: false,
      },
    });
    expect(unlocked.versionNumber).toBe(3);
    expect(
      unlocked.events.find((event) => event.id === "d1-optional-activity"),
    ).toMatchObject({
      startTime: "15:00",
      suggestedDurationSeconds: 3600,
      locked: false,
    });

    const removed = await planService.savePlanEventEdit({
      tripId: trip.id,
      expectedPlanVersion: unlocked.versionNumber,
      edit: {
        eventId: "d1-optional-activity",
        startTime: "15:00",
        durationMinutes: 60,
        note: "展览门票已买",
        locked: false,
        status: "confirmed",
        remove: true,
      },
    });
    expect(removed.versionNumber).toBe(4);
    expect(removed.events.map((event) => event.id)).toEqual(
      firstIds.filter((id) => id !== "d1-optional-activity"),
    );

    await changeAndConfirm(
      trip.id,
      confirmed.requestRevision,
      snapshotWith({ destination: "株洲" }),
    );
    const dates = tripDates(capture.requestSnapshot);
    const staleEdited = await planService.savePlanEventEdit({
      tripId: trip.id,
      expectedPlanVersion: removed.versionNumber,
      edit: {
        eventId: "d1-activity",
        startTime: "23:00",
        durationMinutes: 120,
        note: "夜间抵达后活动",
        locked: false,
        status: "confirmed",
        remove: false,
      },
    });
    expect(staleEdited.versionNumber).toBe(5);
    expect(staleEdited.requestRevision).toBe(2);
    expect(staleEdited.requestSnapshot.destination).toBe("长沙");
    expect(staleEdited.requirementUpToDate).toBe(false);
    expect(
      staleEdited.events.find((event) => event.id === "d1-activity"),
    ).toMatchObject({
      startTime: "23:00",
      endTime: "01:00",
      endDate: dates[1],
      suggestedDurationSeconds: 7200,
    });

    const history = await planService.listPlanVersions(trip.id);
    expect(history.map((plan) => plan.versionNumber)).toEqual([
      5, 4, 3, 2, 1,
    ]);
    expect(history[0].requestSnapshot.destination).toBe("长沙");
    expect(history[0].isCurrent).toBe(true);
  });
});
