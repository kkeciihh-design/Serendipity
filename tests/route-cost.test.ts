import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PlanCostItem } from "../lib/budget";
import type { PlanEvent } from "../lib/plan";
import { applyRouteCost } from "../lib/plan-service";
import type { RouteLeg } from "../lib/routes";

process.env.SERENDIPITY_DATA_DIR = path.resolve("test-data", "unit-route-cost");

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

  it("does not add a route fare when the linked transport event already carries it", () => {
    const costs = applyRouteCost(route("public_transit", 300), [event("from", "activity"), event("to", "local_transport")], [baseCost("cost-to", "to")]);
    expect(costs.some((cost) => cost.id.startsWith("route-"))).toBe(false);
    expect(costs).toHaveLength(1);
  });
});
