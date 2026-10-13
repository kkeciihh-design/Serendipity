import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyPlanCostEdit, budgetFactorsFromSnapshot, calculateBudgetSummary,
  costItemLineTotals, costItemQuantityDescription, eventCostSummary,
  type PlanCostItem,
} from "../lib/budget";
import { validatePlan, type PlanContent, type PlanEvent } from "../lib/plan";
import type { RequestSnapshot } from "../lib/trip-request";
import type { PlaceCandidate } from "../lib/places";
import { manualReferenceRoute } from "../lib/routes";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";

let database: ReturnType<typeof isolatedDatabase>;
let prisma: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");
type SavedPlan = import("../lib/plan-service").PlanVersionRecord;

beforeAll(async () => {
  database = isolatedDatabase("unit-audit-cost");
  prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips");
  requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Cost regression tests must stay offline"); }));
});

afterAll(async () => {
  await Promise.all([prisma?.$disconnect(), trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore()]);
  vi.unstubAllGlobals();
  database?.cleanup();
});

async function seed(days = 2, overrides: Partial<RequestSnapshot> = {}, modify?: (content: PlanContent) => void) {
  const trip = await trips.createTrip({ originalRequest: "审查修复：隔离合成旅行" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture(days, overrides) });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision);
  const content = planFixture(capture.requestSnapshot);
  modify?.(content);
  return plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
}

function costEdit(cost: PlanCostItem, overrides: Partial<Parameters<typeof applyPlanCostEdit>[1]> = {}) {
  return {
    costId: cost.id, unit: cost.unit, unitAmountCents: cost.unitAmountCents,
    unitAmountMaxCents: cost.unitAmountMaxCents, quantity: cost.quantity,
    paymentStatus: cost.paymentStatus, ...overrides,
  };
}

function optionalActivity(content: PlanContent) {
  content.events.push({
    ...content.events.find((event) => event.type === "activity")!,
    id: "optional-activity", startTime: "15:00", endTime: "16:00",
    suggestedDurationSeconds: 3600, costDraftCents: 50000,
  });
}

function eventEdit(event: PlanEvent, overrides: Partial<Parameters<typeof plans.savePlanEventEdit>[0]["edit"]> = {}) {
  return { eventId: event.id, note: event.note ?? null, status: event.status ?? "suggested", locked: event.locked ?? false, remove: false, ...overrides };
}

function candidate(poiId: string): PlaceCandidate {
  return {
    provider: "osm", poiId, name: `合成地点 ${poiId}`, city: "长沙", district: "", address: "", adcode: "", category: "",
    coordinateSystem: "WGS84", longitude: poiId === "1" ? 112.97 : 112.98, latitude: 28.19, retrievedAt: new Date().toISOString(),
  };
}

async function locate(current: SavedPlan) {
  for (const [eventId, poiId] of [["d1-breakfast", "1"], ["d1-activity", "2"]]) {
    current = await plans.savePlanPlaceEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, eventId, candidate: candidate(poiId), precision: "poi" });
  }
  return current;
}

function reference(current: SavedPlan, fareCents: number | null = 600) {
  return manualReferenceRoute({
    tripId: current.tripId, date: current.requestSnapshot.startDate!,
    edit: {
      fromEventId: "d1-breakfast", toEventId: "d1-activity", departureTime: "08:45",
      manualReference: {
        availability: "available", instructions: "合成公交参考，含换乘", durationMinutes: 45, fareCents,
        sourceName: "离线回归数据", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true,
      },
    },
  });
}

function addTransit(count: number, oldTotalCents: number) {
  return (content: PlanContent) => {
    for (let index = 0; index < count; index++) {
      content.events.push({
        ...content.events.find((event) => event.id === "d1-breakfast")!,
        id: `transit-${index}`, type: "local_transport",
        startTime: index === 0 ? "08:45" : "09:00", endTime: index === 0 ? "09:00" : "09:15",
        costDraftCents: oldTotalCents / count, suggestedDurationSeconds: 900,
      });
    }
  };
}

describe("audit cost and route reliability", () => {
  it.each([[2, 2, 30000], [3, 2, 60000], [4, 2, 90000], [4, 3, 180000]])(
    "counts each of %i days' hotel nights once for %i travelers", async (days, travelerCount, expected) => {
      let current = await seed(days, { travelerCount });
      const original = current;
      const hotels = current.costs.filter((cost) => cost.category === "accommodation");
      for (const [index, cost] of hotels.entries()) {
        expect(cost.nightCount).toBe(1);
        current = await plans.savePlanCostEdit({
          tripId: current.tripId, expectedPlanVersion: current.versionNumber,
          edit: costEdit(cost, { unit: "per_room_per_night", unitAmountCents: 30000, paymentStatus: index === 0 ? "paid" : "not_paid" }),
        });
      }
      const summary = calculateBudgetSummary(current.costs, current.requestSnapshot);
      expect(summary.categories.find((group) => group.category === "accommodation")?.minTotalCents).toBe(expected);
      expect(summary.paidMinCents).toBe(travelerCount === 3 ? 60000 : 30000);
      expect((await plans.getPlanVersion(current.tripId, original.versionNumber)).costs).toEqual(original.costs);
      expect(costItemQuantityDescription(current.costs.find((cost) => cost.id === hotels[0].id)!, summary.factors)).toBe(`${travelerCount === 3 ? 2 : 1} 房 × 1 晚`);
    },
  );

  it("keeps a legacy paid whole-trip basis until the user explicitly corrects nights in a new version", async () => {
    let current = await seed(4);
    const legacyCosts = current.costs.map((cost) => {
      const { nightCount, ...legacy } = cost;
      void nightCount;
      return cost.id === "cost-d1-hotel" ? { ...legacy, unit: "per_room_per_night" as const, unitAmountCents: 30000, source: "user_confirmed" as const, certainty: "user_confirmed" as const, paymentStatus: "paid" as const } : legacy;
    });
    const legacyJson = JSON.stringify(legacyCosts);
    await prisma.planVersion.update({ where: { id: current.id }, data: { costs: legacyJson } });
    current = await plans.getPlanVersion(current.tripId, current.versionNumber);
    const legacyVersion = current.versionNumber;
    const hotel = current.costs.find((cost) => cost.id === "cost-d1-hotel")!;
    expect(costItemLineTotals(hotel, budgetFactorsFromSnapshot(current.requestSnapshot)).minCents).toBe(90000);
    current = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events[0], { note: "仅添加备注" }) });
    expect(costItemLineTotals(current.costs.find((cost) => cost.id === hotel.id)!, budgetFactorsFromSnapshot(current.requestSnapshot)).minCents).toBe(90000);
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(hotel, { nightCount: 1 }) });
    expect(current.costs.find((cost) => cost.id === hotel.id)).toMatchObject({ nightCount: 1, paymentStatus: "paid", unitAmountCents: 30000 });
    expect(costItemLineTotals(current.costs.find((cost) => cost.id === hotel.id)!, budgetFactorsFromSnapshot(current.requestSnapshot)).minCents).toBe(30000);
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { tripId_versionNumber: { tripId: current.tripId, versionNumber: legacyVersion } } })).costs).toBe(legacyJson);
  });

  it("rejects invalid night quantities without a new version", async () => {
    const current = await seed(4);
    const hotel = current.costs.find((cost) => cost.category === "accommodation")!;
    for (const nightCount of [0, -1, 5, 1.5]) {
      await expect(plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(hotel, { nightCount }) })).rejects.toThrow("计费晚数");
    }
    expect(await plans.listPlanVersions(current.tripId)).toHaveLength(1);
  });

  it("confirms an unchanged estimate once without claiming payment", async () => {
    const original = await seed();
    const cost = original.costs[0];
    const saved = await plans.savePlanCostEdit({ tripId: original.tripId, expectedPlanVersion: original.versionNumber, edit: costEdit(cost) });
    expect(saved.costs[0]).toMatchObject({ unitAmountCents: 1800, certainty: "user_confirmed", source: "user_confirmed", paymentStatus: "not_paid" });
    await expect(plans.savePlanCostEdit({ tripId: saved.tripId, expectedPlanVersion: saved.versionNumber, edit: costEdit(saved.costs[0]) })).rejects.toThrow("没有需要保存");
    expect(await plans.listPlanVersions(saved.tripId)).toHaveLength(2);
  });

  it("uses confirmed costs for timeline totals and over-budget validation including pricing ranges", async () => {
    let current = await seed(2, { budgetAmountCents: 30000 }, (content) => { content.events.find((event) => event.id === "d1-activity")!.costDraftCents = 100000; });
    expect(current.validationResults.warnings.join(" ")).toContain("超过确认预算");
    const original = current;
    const target = current.costs.find((cost) => cost.linkedEventId === "d1-activity")!;
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(target, { unitAmountCents: 1000 }) });
    expect(calculateBudgetSummary(current.costs, current.requestSnapshot).totalMinCents).toBe(22600);
    expect(eventCostSummary("d1-activity", current.costs, current.requestSnapshot)).toMatchObject({ minCents: 1000, maxCents: 1000, certainty: "user_confirmed" });
    expect(current.validationResults.warnings).toEqual([]);
    expect((await trips.getTrip(current.tripId))?.status).toBe("planned");
    expect((await plans.getPlanVersion(current.tripId, original.versionNumber)).costs).toEqual(original.costs);
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(current.costs.find((cost) => cost.id === target.id)!, { unit: "per_person", unitAmountCents: 2000, unitAmountMaxCents: 10000 }) });
    expect(eventCostSummary("d1-activity", current.costs, current.requestSnapshot)).toMatchObject({ minCents: 4000, maxCents: 20000 });
    expect(current.validationResults.warnings.join(" ")).toContain("可能超过确认预算");
    expect((await trips.getTrip(current.tripId))?.status).toBe("plan_needs_review");
  });

  it("removes only an unconfirmed unpaid estimate from the active budget", async () => {
    const original = await seed(2, {}, optionalActivity);
    expect(calculateBudgetSummary(original.costs, original.requestSnapshot).totalMinCents).toBe(73400);
    const saved = await plans.savePlanEventEdit({ tripId: original.tripId, expectedPlanVersion: original.versionNumber, edit: eventEdit(original.events.find((event) => event.id === "optional-activity")!, { remove: true }) });
    expect(saved.costs.some((cost) => cost.linkedEventId === "optional-activity")).toBe(false);
    expect(calculateBudgetSummary(saved.costs, saved.requestSnapshot).totalMinCents).toBe(23400);
    expect((await plans.getPlanVersion(original.tripId, original.versionNumber)).costs).toEqual(original.costs);
  });

  it("excludes legacy removed predictions from the current plan while preserving the historical JSON", async () => {
    let current = await seed(2, {}, optionalActivity);
    const originalVersion = current.versionNumber;
    const oldCosts = current.costs.map((cost) => cost.linkedEventId === "optional-activity" ? { ...cost, eventRemoved: true } : cost);
    const oldJson = JSON.stringify(oldCosts);
    await prisma.planVersion.update({ where: { id: current.id }, data: {
      costs: oldJson,
      events: JSON.stringify(current.events.filter((event) => event.id !== "optional-activity")),
    } });
    current = await plans.getPlanVersion(current.tripId, originalVersion);
    expect(current.costs.some((cost) => cost.linkedEventId === "optional-activity")).toBe(false);
    expect(calculateBudgetSummary(current.costs, current.requestSnapshot).totalMinCents).toBe(23400);
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { id: current.id } })).costs).toBe(oldJson);
    const saved = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events[0], { note: "保存当前计划" }) });
    expect(saved.costs.some((cost) => cost.linkedEventId === "optional-activity")).toBe(false);
    const history = await plans.getPlanVersion(saved.tripId, originalVersion);
    expect(history.costs).toEqual(oldCosts);
    expect(calculateBudgetSummary(history.costs, history.requestSnapshot).totalMinCents).toBe(73400);
    expect((await prisma.planVersion.findUniqueOrThrow({ where: { id: history.id } })).costs).toBe(oldJson);
  });

  it.each(["not_paid", "paid", "refund_pending"] as const)("retains user-confirmed %s cost facts after removing their event", async (paymentStatus) => {
    let current = await seed(2, {}, optionalActivity);
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(current.costs.find((cost) => cost.linkedEventId === "optional-activity")!, { paymentStatus }) });
    const saved = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events.find((event) => event.id === "optional-activity")!, { remove: true }) });
    expect(saved.costs.find((cost) => cost.linkedEventId === "optional-activity")).toMatchObject({ eventRemoved: true, unitAmountCents: 50000, paymentStatus, certainty: "user_confirmed" });
    expect(calculateBudgetSummary(saved.costs, saved.requestSnapshot).totalMinCents).toBe(73400);
  });

  it.each([
    { travelers: 2, segments: 1, oldTotal: 1000, newFare: 600, expected: 1200 },
    { travelers: 3, segments: 1, oldTotal: 1000, newFare: 600, expected: 1800 },
    { travelers: 2, segments: 2, oldTotal: 1000, newFare: 600, expected: 1200 },
    { travelers: 3, segments: 2, oldTotal: 4200, newFare: 800, expected: 2400 },
  ])("replaces $segments transit estimates with one whole-journey fare for $travelers travelers", async ({ travelers, segments, oldTotal, newFare, expected }) => {
    let current = await seed(2, { travelerCount: travelers }, addTransit(segments, oldTotal));
    current = await locate(current);
    const before = current;
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current, newFare) });
    expect(current.costs.filter((cost) => cost.category === "local_transport")).toHaveLength(1);
    expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unit: "per_person", unitAmountCents: newFare, paymentStatus: "not_paid" });
    expect(current.costs.some((cost) => cost.linkedEventId.startsWith("transit-"))).toBe(false);
    expect(current.events.filter((event) => event.id.startsWith("transit-"))).toHaveLength(segments);
    expect(current.routeLegs[0].transportEventIds).toEqual(Array.from({ length: segments }, (_, index) => `transit-${index}`));
    expect(calculateBudgetSummary(current.costs, current.requestSnapshot).categories.find((group) => group.category === "local_transport")?.minTotalCents).toBe(expected);
    expect((await plans.getPlanVersion(before.tripId, before.versionNumber)).costs).toEqual(before.costs);
    const rechecked = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current, newFare) });
    expect(rechecked.costs).toEqual(current.costs);
  });

  it("replaces stale transit estimates with an unknown fare when the new reference has no price", async () => {
    let current = await locate(await seed(2, { travelerCount: 3 }, addTransit(2, 2400)));
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current, null) });
    expect(current.costs.filter((cost) => cost.category === "local_transport")).toHaveLength(1);
    expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    const summary = calculateBudgetSummary(current.costs, current.requestSnapshot).categories.find((group) => group.category === "local_transport")!;
    expect(summary.minTotalCents).toBe(0);
    expect(summary.unknownItemCount).toBe(1);
    expect(current.costs.some((cost) => cost.linkedEventId.startsWith("transit-"))).toBe(false);
  });

  it("leaves a still-planned transit expense unknown when its route no longer has both endpoints", async () => {
    let current = await locate(await seed(2, { travelerCount: 2 }, addTransit(1, 1000)));
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    const original = current;
    current = await plans.savePlanPlaceEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, eventId: "d1-breakfast", candidate: null, precision: "poi" });
    expect(current.routeLegs).toEqual([]);
    expect(current.events.some((event) => event.id === "transit-0")).toBe(true);
    expect(current.costs.filter((cost) => cost.category === "local_transport")).toHaveLength(1);
    expect(current.costs.find((cost) => cost.linkedEventId === "transit-0")).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    const category = calculateBudgetSummary(current.costs, current.requestSnapshot).categories.find((group) => group.category === "local_transport")!;
    expect(category.unknownItemCount).toBe(1);
    expect((await plans.getPlanVersion(original.tripId, original.versionNumber)).costs).toEqual(original.costs);
  });

  it("keeps a moved transit event unknown after rechecking its former route", async () => {
    let current = await locate(await seed(2, { travelerCount: 2 }, addTransit(1, 1000)));
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    const original = current;
    expect(current.costs.some((cost) => cost.linkedEventId === "transit-0")).toBe(false);
    current = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber,
      edit: eventEdit(current.events.find((event) => event.id === "transit-0")!, { timeEdit: "start_end", startTime: "12:00", endTime: "12:15" }) });
    expect(current.routeLegs[0]).toMatchObject({ manualReference: { requiresReconfirmation: true } });
    expect(current.costs.find((cost) => cost.linkedEventId === "transit-0")).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    expect(current.routeLegs[0].transportEventIds).toEqual([]);
    expect(current.costs.find((cost) => cost.linkedEventId === "transit-0")).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unit: "per_person", unitAmountCents: 600 });
    const category = calculateBudgetSummary(current.costs, current.requestSnapshot).categories.find((group) => group.category === "local_transport")!;
    expect(category.minTotalCents).toBe(1200);
    expect(category.unknownItemCount).toBe(1);
    const noted = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber,
      edit: eventEdit(current.events.find((event) => event.id === "transit-0")!, { note: "后续单独核对这趟交通" }) });
    expect(noted.costs).toEqual(current.costs);
    expect((await plans.getPlanVersion(original.tripId, original.versionNumber)).costs).toEqual(original.costs);
  });

  it.each(["not_paid", "paid", "refund_pending"] as const)("preserves %s confirmed transport facts and explains a different route price", async (paymentStatus) => {
    let current = await locate(await seed(2, { travelerCount: 2 }, addTransit(1, 1000)));
    const transport = current.costs.find((cost) => cost.linkedEventId === "transit-0")!;
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(transport, { paymentStatus }) });
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    expect(current.costs.filter((cost) => cost.id.startsWith("route-"))).toEqual([]);
    const preserved = current.costs.find((cost) => cost.id === transport.id)!;
    expect(preserved).toMatchObject({ unit: "one_time", unitAmountCents: 1000, paymentStatus, source: "user_confirmed" });
    expect(preserved.note).toContain("6 元/人");
    expect(preserved.note).toContain("差额及计价口径");
    expect(calculateBudgetSummary(current.costs, current.requestSnapshot).categories.find((group) => group.category === "local_transport")?.minTotalCents).toBe(1000);
  });

  it("keeps the unpaid remainder unknown when only one transfer has a paid fact", async () => {
    let current = await locate(await seed(2, { travelerCount: 2 }, addTransit(2, 2000)));
    const paid = current.costs.find((cost) => cost.linkedEventId === "transit-0")!;
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(paid, { unitAmountCents: 400, paymentStatus: "paid" }) });
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    expect(current.costs.find((cost) => cost.id === paid.id)).toMatchObject({ unitAmountCents: 400, paymentStatus: "paid" });
    expect(current.costs.some((cost) => cost.linkedEventId === "transit-1")).toBe(false);
    expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    const category = calculateBudgetSummary(current.costs, current.requestSnapshot).categories.find((group) => group.category === "local_transport")!;
    expect(category.minTotalCents).toBe(400);
    expect(category.unknownItemCount).toBe(1);
    const noted = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events[0], { note: "不改变金额" }) });
    expect(noted.costs).toEqual(current.costs);
  });

  it.each([
    { action: "delete", legacy: false }, { action: "move", legacy: false },
    { action: "delete", legacy: true }, { action: "move", legacy: true },
  ])("does not charge again after $action of a paid transit event (legacy association: $legacy)", async ({ action, legacy }) => {
    let current = await locate(await seed(2, { travelerCount: 1 }, addTransit(1, 600)));
    const paid = current.costs.find((cost) => cost.linkedEventId === "transit-0")!;
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: costEdit(paid, { paymentStatus: "paid" }) });
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    if (legacy) {
      const oldRoutes = current.routeLegs.map((route) => {
        const { transportEventIds, ...old } = route;
        void transportEventIds;
        return old;
      });
      await prisma.planVersion.update({ where: { id: current.id }, data: { routeLegs: JSON.stringify(oldRoutes) } });
      current = await plans.getPlanVersion(current.tripId, current.versionNumber);
    }
    const original = current;
    const originalRow = await prisma.planVersion.findUniqueOrThrow({ where: { id: current.id } });
    const transit = current.events.find((event) => event.id === "transit-0")!;
    const edit = action === "delete" ? eventEdit(transit, { remove: true }) :
      eventEdit(transit, { timeEdit: "start_end", startTime: "12:00", endTime: "12:15" });
    current = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit });
    expect(current.costs.find((cost) => cost.id === paid.id)).toMatchObject({ unitAmountCents: 600, paymentStatus: "paid", eventRemoved: action === "delete" });
    expect(current.costs.filter((cost) => cost.id.startsWith("route-"))).toEqual([]);
    expect(current.routeLegs[0]).toMatchObject({ transportEventIds: ["transit-0"], status: "pending_confirmation", durationSeconds: null, manualReference: { requiresReconfirmation: true } });
    expect(current.routeLegs[0].manualReference?.instructions).toBe(original.routeLegs[0].manualReference?.instructions);
    const summary = calculateBudgetSummary(current.costs, current.requestSnapshot);
    expect(summary.categories.find((group) => group.category === "local_transport")?.minTotalCents).toBe(600);
    expect(summary.paidMinCents).toBe(600);
    const history = await prisma.planVersion.findUniqueOrThrow({ where: { id: original.id } });
    expect(history.costs).toBe(originalRow.costs);
    expect(history.routeLegs).toBe(originalRow.routeLegs);
  });

  it("keeps paid route facts when deduplicating a transit draft and flags conflicting user facts", async () => {
    const current = await seed();
    const route = reference(current);
    const transport = {
      ...current.events.find((event) => event.id === "d1-breakfast")!,
      id: "transit", type: "local_transport" as const, startTime: "08:45", endTime: "09:15", costDraftCents: 600,
    };
    const events = [...current.events, transport];
    const routeCost = { ...plans.applyRouteCost(route, current.events, [])[0], paymentStatus: "paid" as const };
    const draft: PlanCostItem = {
      id: "cost-transit", linkedEventId: "transit", category: "local_transport", currency: "CNY", unit: "one_time",
      unitAmountCents: 600, unitAmountMaxCents: null, quantity: null, certainty: "estimated", paymentStatus: "not_paid",
      source: "ai_draft", eventRemoved: false, note: null,
    };
    const deduplicated = plans.applyRouteCost(route, events, [routeCost, draft]);
    expect(deduplicated).toEqual([routeCost]);
    const paidTransport = { ...draft, paymentStatus: "paid" as const };
    const bothPaid = plans.applyRouteCost(route, events, [routeCost, paidTransport]);
    expect(bothPaid).toHaveLength(2);
    expect(bothPaid.find((cost) => cost.id === paidTransport.id)).toEqual(paidTransport);
    expect(bothPaid.find((cost) => cost.id === routeCost.id)).toMatchObject({ paymentStatus: "paid", unitAmountCents: 600 });
    expect(bothPaid.find((cost) => cost.id === routeCost.id)?.note).toContain("可能重复");
  });

  it("preserves route references for note, confirmation and lock changes, then invalidates a real time change", async () => {
    let current = await locate(await seed());
    current = await plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route: reference(current) });
    const original = current;
    for (const change of [{ note: "记得带水" }, { status: "confirmed" as const }, { locked: true }, { locked: false }]) {
      current = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events.find((event) => event.id === "d1-breakfast")!, change) });
      expect(current.routeLegs).toEqual(original.routeLegs);
      expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toEqual(original.costs.find((cost) => cost.id.startsWith("route-")));
    }
    current = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events.find((event) => event.id === "d1-activity")!, { timeEdit: "start_end", endTime: "11:00" }) });
    expect(current.routeLegs).toEqual(original.routeLegs);
    current = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, edit: eventEdit(current.events.find((event) => event.id === "d1-breakfast")!, { timeEdit: "start_end", endTime: "09:00" }) });
    expect(current.routeLegs[0]).toMatchObject({ durationSeconds: null, arrivalTime: null, manualReference: { requiresReconfirmation: true } });
    expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unitAmountCents: null });
    expect((await plans.getPlanVersion(original.tripId, original.versionNumber)).routeLegs).toEqual(original.routeLegs);
  });
});
