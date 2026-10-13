import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validatePlanCosts, type PlanCostItem } from "../lib/budget";
import type { PlanEvent } from "../lib/plan";
import type { RouteLeg } from "../lib/routes";
import { assertTestDataPath } from "../scripts/test-data-safety.mjs";

let plans: typeof import("../lib/plan-service");
let applyRouteCost: typeof plans.applyRouteCost;
let updateRoutesAfterEventChange: typeof plans.updateRoutesAfterEventChange;
beforeAll(async () => {
  process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data", "unit-route-cost"));
  plans = await import("../lib/plan-service");
  ({ applyRouteCost, updateRoutesAfterEventChange } = plans);
});
afterAll(async () => { await plans?.closePlanStore(); });

function event(id: string, type: PlanEvent["type"]): PlanEvent {
  return {
    id,
    dayNumber: 1,
    date: "2026-10-12",
    startTime: "08:00",
    endTime: "09:00",
    type,
    title: id,
    locationName: id,
    placeId: id,
    suggestedDurationSeconds: 3600,
    costDraftCents: 0,
    costStatus: "estimated",
    note: null,
  };
}

function route(mode: RouteLeg["mode"], amountCents: number | null): RouteLeg {
  return {
    id: `route-${mode}`,
    fromEventId: "from",
    toEventId: "to",
    date: "2026-10-12",
    departureTime: "09:00",
    validFromTime: "09:00",
    validUntilTime: "09:00",
    arrivalDate: "2026-10-12",
    arrivalTime: "09:30",
    mode,
    status: "verified",
    distanceMeters: 1000,
    durationSeconds: 1800,
    includedTimes: mode === "public_transit" ? ["walking", "waiting", "riding", "transfer"] : mode === "walking" ? ["walking"] : ["driving"],
    polyline: [{ longitude: 114.1, latitude: 22.5 }, { longitude: 114.11, latitude: 22.51 }],
    coordinateSystem: "WGS84",
    steps: [],
    futureQueryCapability: true,
    candidateRecheck: {
      attempts: 1,
      status: "converged",
      requestedDepartureTime: "09:00",
      finalDepartureTime: "09:00",
      reason: "测试",
    },
    scheduleBasis: "测试班次",
    cost: { minCents: amountCents, maxCents: amountCents, basis: "测试票价", source: "测试" },
    cacheKey: "0123456789abcdef0123456789abcdef",
    source: "测试",
    retrievedAt: "2026-10-12T01:00:00.000Z",
    conflict: null,
  };
}

function baseCost(id: string, linkedEventId: string): PlanCostItem {
  return {
    id,
    linkedEventId,
    category: "meal",
    currency: "CNY",
    unit: "one_time",
    unitAmountCents: 2000,
    unitAmountMaxCents: null,
    quantity: null,
    certainty: "estimated",
    paymentStatus: "not_paid",
    source: "ai_draft",
    eventRemoved: false,
    note: null,
  };
}

describe("route costs", () => {
  it("uses per-person transit pricing and one-car driving pricing once", () => {
    const costs = applyRouteCost(route("public_transit", 300), [event("from", "activity"), event("to", "meal")], [baseCost("cost-to", "to")]);
    const transitCost = costs.find((cost) => cost.id.startsWith("route-"));
    expect(transitCost).toMatchObject({ category: "local_transport", unit: "per_person", unitAmountCents: 300, linkedEventId: "to" });

    const drivingCosts = applyRouteCost(route("driving", 300), [event("from", "activity"), event("to", "meal")], [baseCost("cost-to", "to")]);
    expect(drivingCosts.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unit: "one_time" });
  });

  it("replaces the unconfirmed endpoint transport estimate with the route fare once", () => {
    const costs = applyRouteCost(route("public_transit", 300), [event("from", "activity"), event("to", "local_transport")], [baseCost("cost-to", "to")]);
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ unitAmountCents: 300, unit: "per_person", linkedEventId: "to" });
    expect(costs[0].id).toMatch(/^route-/);
  });

  it("replaces the same pair's fare once and keeps manual references pending", () => {
    const events = [event("from", "activity"), event("to", "meal")];
    const reference = { ...route("public_transit", 600), status: "pending_confirmation" as const };
    const first = applyRouteCost(reference, events, []);
    const second = applyRouteCost({ ...reference, cost: { ...reference.cost, minCents: 800, maxCents: 800 } }, events, first);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ unitAmountCents: 800, unit: "per_person", certainty: "pending_confirmation" });
  });

  it("retains confirmed and paid amounts through invalidation and mode changes", () => {
    const events = [event("from", "activity"), { ...event("to", "meal"), startTime: "10:00", endTime: "11:00" }];
    const original = applyRouteCost(route("public_transit", 600), events, []);
    for (const protectedCost of [
      { ...original[0], source: "user_confirmed" as const },
      { ...original[0], paymentStatus: "paid" as const },
    ]) {
      const { note, ...facts } = protectedCost;
      void note;
      const changedMode = applyRouteCost(route("walking", 0), events, [protectedCost]);
      expect(changedMode).toHaveLength(1);
      expect(changedMode[0]).toMatchObject(facts);
      expect(changedMode[0].note).toContain("原确认或付款金额保留");
      const invalidated = updateRoutesAfterEventChange([route("public_transit", 600)], events, [protectedCost], "from").costs;
      expect(invalidated).toHaveLength(1);
      expect(invalidated[0]).toMatchObject(facts);
    }
  });

  it("marks derived costs unknown after a schedule change and removes them with a deleted route", () => {
    const events = [event("from", "activity"), { ...event("to", "meal"), startTime: "10:00", endTime: "11:00" }];
    const reference = route("public_transit", 600);
    const original = applyRouteCost(reference, events, []);
    const changed = updateRoutesAfterEventChange([reference], events, original, "from");
    expect(changed.costs[0]).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    expect(changed.routeLegs[0]).toMatchObject({ durationSeconds: null, arrivalTime: null });
    expect(updateRoutesAfterEventChange([reference], [events[1]], original, "from")).toEqual({ routeLegs: [], costs: [] });
  });

  it("removes a nonadjacent route draft but preserves paid facts without blocking the new pair", () => {
    const events = [event("from", "activity"), { ...event("middle", "activity"), startTime: "09:00", endTime: "09:30" }, { ...event("to", "meal"), startTime: "10:00", endTime: "11:00" }];
    const oldRoute = route("public_transit", 600);
    const original = applyRouteCost(oldRoute, events, []);
    expect(updateRoutesAfterEventChange([oldRoute], events, original, "middle")).toEqual({ routeLegs: [], costs: [] });
    for (const protectedCost of [{ ...original[0], paymentStatus: "paid" as const }, { ...original[0], source: "user_confirmed" as const }]) {
      const changed = updateRoutesAfterEventChange([oldRoute], events, [protectedCost], "middle");
      expect(changed.routeLegs).toEqual([]);
      expect(changed.costs[0]).toMatchObject({ unitAmountCents: 600, paymentStatus: protectedCost.paymentStatus });
      expect(changed.costs[0].note).toContain("原路线已不再适用");
      const costs = applyRouteCost({ ...oldRoute, fromEventId: "middle" }, events, changed.costs);
      expect(costs).toHaveLength(2);
      expect(validatePlanCosts(costs, events)).toEqual([]);
    }
    expect(validatePlanCosts([...original, { ...original[0], id: "route-other" }], events).join(" ")).toContain("重复关联");
    expect(validatePlanCosts([original[0], original[0]], events).join(" ")).toContain("重复");
  });
});
