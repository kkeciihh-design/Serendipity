import { describe, expect, it, vi } from "vitest";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { derivePlanCosts } from "../lib/budget";
import { preparePlanForStorage, validatePlan } from "../lib/plan";
import type { PlanVersionRecord } from "../lib/plan-service";
import type { RouteLeg } from "../lib/routes";
import { refreshReplanRoutes } from "../lib/replan-service";
import { queryPlanRoute } from "../lib/route-service";
vi.mock("../lib/route-service", () => ({ queryPlanRoute: vi.fn() }));
const now = "2026-10-16T00:00:00.000Z";
function route(from: string, to: string, date: string): RouteLeg {
  return { id: `${from}-${to}`, fromEventId: from, toEventId: to, date, departureTime: "12:00", validFromTime: "12:00", validUntilTime: "12:00", arrivalDate: date, arrivalTime: "12:10",
    mode: "walking", status: "estimated", distanceMeters: 600, durationSeconds: 600, includedTimes: ["walking"], polyline: [], coordinateSystem: "WGS84", steps: [], futureQueryCapability: false,
    candidateRecheck: { attempts: 1, status: "not_applicable", requestedDepartureTime: "12:00", finalDepartureTime: "12:00", reason: "步行估算" }, scheduleBasis: "步行估算", cost: { minCents: 0, maxCents: 0, basis: "步行", source: "测试" }, cacheKey: "test-route-key-00000000", source: "测试", retrievedAt: now, conflict: null };
}
function fixture() {
  const snapshot = requestFixture(), content = preparePlanForStorage(planFixture(snapshot)), costs = derivePlanCosts(content.events);
  for (const id of ["d1-activity", "d1-lunch", "d1-rest"]) content.events.find((e) => e.id === id)!.placeId = id;
  return { ...content, id: "plan", tripId: "trip", versionNumber: 1, requestRevision: 2, requestSnapshot: snapshot, costs,
    places: [], routeLegs: [route("d1-activity", "d1-lunch", snapshot.startDate!), route("d1-lunch", "d1-rest", snapshot.startDate!)], tickets: [], validationResults: validatePlan(content, snapshot), requirementUpToDate: true, isCurrent: true, createdAt: now, updatedAt: now } satisfies PlanVersionRecord;
}
describe("重规划路线按最终相邻关系复核", () => {
  it("two edited endpoints trigger one lookup per final edge, not multiple three-round resolvers", async () => {
    const base = fixture(), proposed = structuredClone(base);
    proposed.events.find((e) => e.id === "d1-activity")!.endTime = "11:50";
    proposed.events.find((e) => e.id === "d1-lunch")!.startTime = "12:20";
    vi.mocked(queryPlanRoute).mockImplementation(async (_plan, input) => { const i = input as { fromEventId: string; toEventId: string }; return route(i.fromEventId, i.toEventId, base.requestSnapshot.startDate!); });
    const result = await refreshReplanRoutes(base, proposed, undefined, now);
    expect(queryPlanRoute).toHaveBeenCalledTimes(2); expect(result.plan.routeLegs).toHaveLength(2);
    vi.mocked(queryPlanRoute).mockClear();
  });
  it("deleting a mapped stop queries the newly adjacent pair and does not keep either obsolete route", async () => {
    const base = fixture(), proposed = structuredClone(base); proposed.events = proposed.events.filter((e) => e.id !== "d1-lunch");
    vi.mocked(queryPlanRoute).mockImplementation(async (_plan, input) => { const i = input as { fromEventId: string; toEventId: string }; return route(i.fromEventId, i.toEventId, base.requestSnapshot.startDate!); });
    const result = await refreshReplanRoutes(base, proposed, undefined, now);
    expect(result.plan.routeLegs.map((r) => [r.fromEventId, r.toEventId])).toEqual([["d1-activity", "d1-rest"]]);
    expect(queryPlanRoute).toHaveBeenCalledTimes(1); vi.mocked(queryPlanRoute).mockClear();
  });
  it("an unlocated replacement invalidates both old geometry and duration without treating the replacement trip as free", async () => {
    const base = fixture(), proposed = structuredClone(base); proposed.events.find((e) => e.id === "d1-lunch")!.placeId = null;
    base.routeLegs.forEach((r) => r.mode = "public_transit"); proposed.routeLegs.forEach((r) => r.mode = "public_transit");
    vi.mocked(queryPlanRoute).mockRejectedValue(new Error("unavailable"));
    const result = await refreshReplanRoutes(base, proposed, undefined, now);
    expect(result.plan.routeLegs.every((r) => r.durationSeconds === null && r.polyline.length === 0)).toBe(true);
    expect(result.plan.costs.some((c) => c.id.startsWith("route-") && c.unitAmountCents === null)).toBe(true);
    vi.mocked(queryPlanRoute).mockClear();
  });
});
