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
import { calculateBudgetSummary } from "../lib/budget";

const testDataDirectory = path.resolve("test-data", "unit-budget-version");
let trips: typeof import("../lib/trips");
let requestService: typeof import("../lib/trip-request-service");
let planService: typeof import("../lib/plan-service");

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

function event(
  input: Partial<PlanEvent> &
    Pick<PlanEvent, "id" | "dayNumber" | "date" | "startTime" | "endTime" | "type" | "title">,
): PlanEvent {
  return {
    locationName: "市中心区域",
    suggestedDurationSeconds: 3600,
    costDraftCents: null,
    costStatus: "pending_confirmation",
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
      event({
        id: `d${dayNumber}-breakfast`,
        dayNumber,
        date,
        startTime: "08:00",
        endTime: "08:45",
        type: "meal",
        title: "早餐",
        costDraftCents: 2000,
      }),
      event({
        id: `d${dayNumber}-activity`,
        dayNumber,
        date,
        startTime: "10:00",
        endTime: "12:00",
        type: "activity",
        title: "城市漫步",
      }),
      event({
        id: `d${dayNumber}-lunch`,
        dayNumber,
        date,
        startTime: "12:30",
        endTime: "13:30",
        type: "meal",
        title: "午餐",
        costDraftCents: 6000,
      }),
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
      id: "d1-optional",
      dayNumber: 1,
      date: dates[0],
      startTime: "15:00",
      endTime: "16:00",
      type: "activity",
      title: "可选城市展览",
      costDraftCents: 6000,
    }),
    event({
      id: "departure",
      dayNumber: 1,
      date: dates[0],
      startTime: "06:30",
      endTime: "07:30",
      type: "departure_transport",
      title: "去程",
      locationName: "出发站",
      costDraftCents: 48600,
    }),
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

function saveCurrentPlan(
  capture: Awaited<ReturnType<typeof planService.getPlanGenerationContext>>,
) {
  const plan = completePlan(capture.requestSnapshot);
  return planService.savePlanVersion({
    capture,
    plan,
    validationResults: validatePlan(plan, capture.requestSnapshot),
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
});

afterAll(async () => {
  await Promise.all([
    trips.closeTripStore(),
    requestService.closeTripRequestStore(),
    planService.closePlanStore(),
  ]);
  fs.rmSync(testDataDirectory, { recursive: true, force: true });
});

describe("budget version inheritance and snapshot recalculation", () => {
  it("keeps the old snapshot for cost edits and recovers costs after reopening", async () => {
    const original = "阶段09验收：两天长沙预算确认。";
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
    const first = await saveCurrentPlan(capture);
    expect(first.costs).toHaveLength(first.events.length);
    expect(first.costs.find((cost) => cost.id === "cost-departure"))
      .toMatchObject({
        linkedEventId: "departure",
        category: "transport",
        unit: "one_time",
        unitAmountCents: 48600,
        certainty: "pending_confirmation",
        paymentStatus: "not_paid",
      });

    await changeAndConfirm(
      trip.id,
      confirmed.requestRevision,
      snapshotWith({ destination: "株洲" }),
    );

    const edited = await planService.savePlanCostEdit({
      tripId: trip.id,
      expectedPlanVersion: first.versionNumber,
      edit: {
        costId: "cost-departure",
        unit: "per_person",
        unitAmountCents: 10000,
        unitAmountMaxCents: null,
        quantity: null,
        paymentStatus: "paid",
      },
    });
    expect(edited.versionNumber).toBe(2);
    expect(edited.requestRevision).toBe(first.requestRevision);
    expect(edited.requestSnapshot.destination).toBe("长沙");
    expect(edited.requirementUpToDate).toBe(false);
    expect(edited.costs.find((cost) => cost.id === "cost-departure"))
      .toMatchObject({
        unit: "per_person",
        unitAmountCents: 10000,
        certainty: "user_confirmed",
        paymentStatus: "paid",
        source: "user_confirmed",
      });

    const summary = calculateBudgetSummary(
      edited.costs,
      edited.requestSnapshot,
    );
    expect(summary.factors.travelerCount).toBe(2);
    expect(summary.budgetTargetCents).toBe(150000);
    expect(summary.paidMinCents).toBe(20000);

    await planService.closePlanStore();
    await trips.closeTripStore();
    const reopened = await planService.listPlanVersions(trip.id);
    expect(reopened[0].versionNumber).toBe(2);
    expect(reopened[0].costs.find((cost) => cost.id === "cost-departure"))
      .toMatchObject({
        unit: "per_person",
        unitAmountCents: 10000,
        paymentStatus: "paid",
      });
    expect(reopened[1].costs.find((cost) => cost.id === "cost-departure"))
      .toMatchObject({
        unit: "one_time",
        unitAmountCents: 48600,
        certainty: "pending_confirmation",
      });
  });

  it("recalculates from the new snapshot only after phase 06 commits a new version", async () => {
    const original = "阶段09验收：T29预算快照切换。";
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
    const first = await saveCurrentPlan(capture);

    const oldEdited = await planService.savePlanCostEdit({
      tripId: trip.id,
      expectedPlanVersion: first.versionNumber,
      edit: {
        costId: "cost-departure",
        unit: "per_person",
        unitAmountCents: 10000,
        unitAmountMaxCents: null,
        quantity: null,
        paymentStatus: "not_paid",
      },
    });
    const oldSummary = calculateBudgetSummary(
      oldEdited.costs,
      oldEdited.requestSnapshot,
    );
    expect(oldSummary.factors).toEqual({
      travelerCount: 2,
      roomCount: 1,
      nightCount: 1,
    });
    expect(oldSummary.budgetTargetCents).toBe(150000);

    const changed = snapshotWith({
      travelerCount: 4,
      budgetAmountCents: 300000,
      budgetScope: "total",
    });
    const changedConfirmed = await changeAndConfirm(
      trip.id,
      confirmed.requestRevision,
      changed,
    );

    const stalePlans = await planService.listPlanVersions(trip.id);
    const staleSummary = calculateBudgetSummary(
      stalePlans[0].costs,
      stalePlans[0].requestSnapshot,
    );
    expect(stalePlans[0].requirementUpToDate).toBe(false);
    expect(staleSummary.factors.travelerCount).toBe(2);
    expect(staleSummary.budgetTargetCents).toBe(150000);

    const newCapture = await planService.getPlanGenerationContext(
      trip.id,
      changedConfirmed.requestRevision,
    );
    const regenerated = await saveCurrentPlan(newCapture);
    expect(regenerated.versionNumber).toBe(3);
    expect(regenerated.requestSnapshot.travelerCount).toBe(4);
    expect(regenerated.requestSnapshot.budgetAmountCents).toBe(300000);

    const newEdited = await planService.savePlanCostEdit({
      tripId: trip.id,
      expectedPlanVersion: regenerated.versionNumber,
      edit: {
        costId: "cost-departure",
        unit: "per_person",
        unitAmountCents: 10000,
        unitAmountMaxCents: null,
        quantity: null,
        paymentStatus: "not_paid",
      },
    });
    const newSummary = calculateBudgetSummary(
      newEdited.costs,
      newEdited.requestSnapshot,
    );
    expect(newSummary.factors).toEqual({
      travelerCount: 4,
      roomCount: 2,
      nightCount: 1,
    });
    expect(newSummary.budgetTargetCents).toBe(300000);

    const history = await planService.listPlanVersions(trip.id);
    const stillOld = calculateBudgetSummary(
      history.find((plan) => plan.versionNumber === 2)!.costs,
      history.find((plan) => plan.versionNumber === 2)!.requestSnapshot,
    );
    expect(stillOld.factors.travelerCount).toBe(2);
    expect(stillOld.budgetTargetCents).toBe(150000);

    await expect(
      planService.savePlanCostEdit({
        tripId: trip.id,
        expectedPlanVersion: 2,
        edit: {
          costId: "cost-departure",
          unit: "per_person",
          unitAmountCents: 10000,
          unitAmountMaxCents: null,
          quantity: null,
          paymentStatus: "not_paid",
        },
      }),
    ).rejects.toMatchObject({ name: "PlanConflictError" });
  });

  it("preserves spent costs when their linked event is removed", async () => {
    const original = "阶段09验收：移除安排不等于退款。";
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
    const first = await saveCurrentPlan(capture);

    const paid = await planService.savePlanCostEdit({
      tripId: trip.id,
      expectedPlanVersion: first.versionNumber,
      edit: {
        costId: "cost-d1-optional",
        unit: "one_time",
        unitAmountCents: 6000,
        unitAmountMaxCents: null,
        quantity: null,
        paymentStatus: "paid",
      },
    });

    const removed = await planService.savePlanEventEdit({
      tripId: trip.id,
      expectedPlanVersion: paid.versionNumber,
      edit: {
        eventId: "d1-optional",
        startTime: "15:00",
        durationMinutes: 60,
        note: null,
        locked: false,
        status: "suggested",
        remove: true,
      },
    });
    expect(removed.events.some((item) => item.id === "d1-optional")).toBe(
      false,
    );
    const preservedCost = removed.costs.find(
      (cost) => cost.id === "cost-d1-optional",
    );
    expect(preservedCost).toMatchObject({
      linkedEventId: "d1-optional",
      eventRemoved: true,
      unitAmountCents: 6000,
      certainty: "user_confirmed",
      paymentStatus: "paid",
    });
    expect(
      calculateBudgetSummary(removed.costs, removed.requestSnapshot)
        .removedEventItemCount,
    ).toBe(1);
    expect(removed.costs).toHaveLength(paid.costs.length);
  });
});
