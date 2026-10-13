import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clearRouteCache, readCachedRoute } from "../lib/routes";
import type { PlaceCandidate } from "../lib/places";
import { nextPlanDate, validatePlan } from "../lib/plan";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";

let database: ReturnType<typeof isolatedDatabase>;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");
let routes: typeof import("../lib/route-service");
let settings: typeof import("../lib/settings");
let mapSettings: typeof import("../lib/map-settings");

beforeAll(async () => {
  database = isolatedDatabase("unit-manual-route");
  trips = await import("../lib/trips");
  requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service");
  routes = await import("../lib/route-service");
  settings = await import("../lib/settings");
  mapSettings = await import("../lib/map-settings");
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearRouteCache(); });
afterAll(async () => {
  await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), settings?.closeSettingsStore(), mapSettings?.closeMapSettingsStore()]);
  database?.cleanup();
});

function candidate(id: string): PlaceCandidate {
  return {
    provider: "osm", poiId: id, name: `测试地点 ${id}`, city: "长沙", district: "", address: "", adcode: "", category: "",
    coordinateSystem: "WGS84", longitude: id === "1" ? 112.97 : 112.98, latitude: 28.19,
    retrievedAt: new Date().toISOString(),
  };
}

async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "隔离测试：两天长沙行程" });
  const request = requestFixture();
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision);
  const plan = planFixture(capture.requestSnapshot);
  let current = await plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) });
  for (const [eventId, poiId] of [["d1-breakfast", "1"], ["d1-activity", "2"]]) {
    current = await plans.savePlanPlaceEdit({ tripId: trip.id, expectedPlanVersion: current.versionNumber, eventId, candidate: candidate(poiId), precision: "poi" });
  }
  return current;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    fromEventId: "d1-breakfast", toEventId: "d1-activity", departureTime: "08:45",
    manualReference: {
      availability: "available", instructions: "步行 10 分钟到 A 站\n地铁 1 号线 A 站上车，B 站下车",
      durationMinutes: 45, fareCents: 600, sourceName: "人工地图查询", sourceUrl: "https://uri.amap.com/navigation",
      checkedAt: new Date().toISOString(), acknowledged: true, ...overrides,
    },
  };
}

describe("manual route persistence", () => {
  it("saves a new version offline, binds server date, and rejects stale or cancelled writes", async () => {
    const current = await fixture();
    const fetchMock = vi.fn(() => { throw new Error("Manual records must not request a service"); });
    vi.stubGlobal("fetch", fetchMock);
    const saved = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, { ...input(), date: "2099-01-01" });
    expect(saved.versionNumber).toBe(current.versionNumber + 1);
    expect(saved.routeLegs[0]).toMatchObject({ date: current.events[0].date, durationSeconds: 2700, arrivalTime: "09:30", status: "pending_confirmation", polyline: [], futureQueryCapability: false });
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(1);
    expect(saved.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unit: "per_person", unitAmountCents: 600, certainty: "pending_confirmation" });
    expect(readCachedRoute(saved.routeLegs[0].cacheKey)).toBeNull();
    expect((await plans.getPlanVersion(current.tripId, saved.versionNumber)).routeLegs).toEqual(saved.routeLegs);
    expect((await plans.getPlanVersion(current.tripId, current.versionNumber)).routeLegs).toEqual([]);
    await expect(routes.saveManualPlanRoute(current.tripId, current.versionNumber, input())).rejects.toThrow("计划已变化");
    await expect(routes.saveManualPlanRoute(current.tripId, saved.versionNumber, input(), AbortSignal.abort())).rejects.toThrow("已取消");
    expect((await plans.listPlanVersions(current.tripId))[0].versionNumber).toBe(saved.versionNumber);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects early, reverse, malformed and future-source records without writing", async () => {
    const current = await fixture();
    for (const invalid of [
      { ...input(), departureTime: "08:00" },
      { ...input(), fromEventId: "d1-activity", toEventId: "d1-breakfast", departureTime: "12:00" },
      { ...input(), toEventId: "d1-lunch" },
      input({ checkedAt: "2099-01-01T00:00:00.000Z" }),
      input({ sourceUrl: "javascript:alert(1)" }),
      input({ availability: "no_service" }),
    ]) await expect(routes.saveManualPlanRoute(current.tripId, current.versionNumber, invalid)).rejects.toThrow();
    expect((await plans.listPlanVersions(current.tripId))[0].versionNumber).toBe(current.versionNumber);
  });

  it("keeps references on the old request dates and requires new records after regeneration", async () => {
    let current = await fixture();
    const fetchMock = vi.fn(() => { throw new Error("Synthetic date-change records must stay offline"); });
    vi.stubGlobal("fetch", fetchMock);
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, input({
      instructions: "日期变更测试数据：步行至测试 A 站，再乘虚构测试线路至 B 站",
      sourceName: "隔离测试数据（非真实公交）",
    }));
    const original = current;
    const revisedDates = {
      ...original.requestSnapshot,
      startDate: nextPlanDate(original.requestSnapshot.startDate!),
      endDate: nextPlanDate(original.requestSnapshot.endDate!),
    };
    const draft = await requests.saveRequestDraft(current.tripId, {
      expectedRequestRevision: original.requestRevision, request: revisedDates,
    });
    expect(draft).toMatchObject({ confirmedRequest: null, confirmedRevision: null, confirmedAt: null });
    const stale = await plans.getPlanVersion(current.tripId, original.versionNumber);
    expect(stale).toMatchObject({ requirementUpToDate: false, requestSnapshot: original.requestSnapshot });
    expect(stale.events).toEqual(original.events);
    expect(stale.routeLegs).toEqual(original.routeLegs);
    expect(stale.routeLegs[0]).toMatchObject({
      date: original.requestSnapshot.startDate,
      manualReference: { date: original.requestSnapshot.startDate, departureTime: "08:45" },
    });

    await requests.confirmRequest(current.tripId, { expectedRequestRevision: draft.requestRevision });
    // Confirmed locations are protected facts: changing the request date alone
    // must not silently replace them or the route attached to the old snapshot.
    await expect(plans.getPlanGenerationContext(current.tripId, draft.requestRevision)).rejects.toThrow("已保留当前计划");
    expect((await plans.getPlanVersion(current.tripId, original.versionNumber)).routeLegs).toEqual(original.routeLegs);
    for (const eventId of ["d1-breakfast", "d1-activity"]) {
      current = await plans.savePlanPlaceEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, eventId, candidate: null, precision: "poi" });
    }
    const capture = await plans.getPlanGenerationContext(current.tripId, draft.requestRevision);
    const content = planFixture(capture.requestSnapshot);
    current = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
    expect(current).toMatchObject({ requirementUpToDate: true, requestSnapshot: revisedDates, routeLegs: [] });
    expect(current.costs.some((cost) => cost.id.startsWith("route-"))).toBe(false);
    for (const [eventId, poiId] of [["d1-breakfast", "1"], ["d1-activity", "2"]]) {
      current = await plans.savePlanPlaceEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, eventId, candidate: candidate(poiId), precision: "poi" });
    }
    await expect(routes.saveManualPlanRoute(current.tripId, current.versionNumber, input({ acknowledged: false }))).rejects.toThrow();
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, input({
      instructions: "新日期测试数据：重新查阅的虚构公交参考",
      sourceName: "隔离测试数据（非真实公交）", durationMinutes: 60, fareCents: 800,
    }));
    expect(current.routeLegs).toHaveLength(1);
    expect(current.routeLegs[0]).toMatchObject({
      date: revisedDates.startDate, arrivalDate: revisedDates.startDate, arrivalTime: "09:45",
      manualReference: { date: revisedDates.startDate, departureTime: "08:45", requiresReconfirmation: false },
    });
    const history = await plans.getPlanVersion(current.tripId, original.versionNumber);
    expect(history.isCurrent).toBe(false);
    expect(history.requestSnapshot).toEqual(original.requestSnapshot);
    expect(history.routeLegs).toEqual(original.routeLegs);
    expect(history.costs).toEqual(original.costs);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replaces timing once, supports unknown and no-service records, and invalidates changed events", async () => {
    let current = await fixture();
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, input());
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, { ...input({ durationMinutes: 85 }), departureTime: "09:05" });
    expect(current.routeLegs).toHaveLength(1);
    expect(current.routeLegs[0]).toMatchObject({ arrivalTime: "10:30", durationSeconds: 5100 });
    expect(current.routeLegs[0].conflict).toContain("晚于");
    expect(current.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(1);
    const changed = await plans.savePlanEventEdit({
      tripId: current.tripId, expectedPlanVersion: current.versionNumber,
      edit: { eventId: "d1-breakfast", timeEdit: "start_end", startTime: "08:00", endTime: "09:00", note: null, status: "suggested", locked: false, remove: false },
    });
    expect(changed.routeLegs[0]).toMatchObject({ departureTime: "09:00", arrivalTime: null, durationSeconds: null, manualReference: { departureTime: "09:05", durationMinutes: 85, requiresReconfirmation: true } });
    expect(changed.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    current = await routes.saveManualPlanRoute(current.tripId, changed.versionNumber, { ...input({ durationMinutes: null, fareCents: null }), departureTime: "09:05" });
    expect(current.routeLegs[0]).toMatchObject({ durationSeconds: null, arrivalTime: null, cost: { minCents: null }, manualReference: { requiresReconfirmation: false } });
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, { ...input({ availability: "no_service", durationMinutes: null, fareCents: null, instructions: "该时刻无运营" }), departureTime: "23:50" });
    expect(current.routeLegs[0]).toMatchObject({ status: "unavailable", durationSeconds: null, arrivalTime: null, conflict: null });
    expect(current.costs.filter((cost) => cost.id.startsWith("route-"))).toEqual([]);
  });

  it("keeps automatic walking results and their cache separate from manual references", async () => {
    let current = await fixture();
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, input());
    const fetchMock = vi.fn(async () => Response.json({
      code: "Ok", routes: [{ distance: 1234, duration: 567, geometry: "ygqhC_jdwT@lE", legs: [{ steps: [{ name: "测试路", maneuver: { type: "depart" }, distance: 1234, duration: 567 }] }] }],
    }));
    vi.stubGlobal("fetch", fetchMock);
    current = await routes.searchAndSavePlanRoute(current.tripId, current.versionNumber, { fromEventId: "d1-breakfast", toEventId: "d1-activity", mode: "walking", departureTime: "08:45" });
    expect(current.routeLegs[0]).toMatchObject({ mode: "walking", status: "verified", durationSeconds: 567, distanceMeters: 1234 });
    expect(current.routeLegs[0].manualReference).toBeUndefined();
    expect(current.routeLegs[0].polyline).toHaveLength(2);
    expect(current.costs.filter((cost) => cost.id.startsWith("route-"))).toEqual([]);
    const cached = readCachedRoute(current.routeLegs[0].cacheKey);
    expect(cached?.durationSeconds).toBe(567);
    const next = await routes.searchAndSavePlanRoute(current.tripId, current.versionNumber, { fromEventId: "d1-breakfast", toEventId: "d1-activity", mode: "walking", departureTime: "08:45" });
    expect(next.routeLegs[0].cacheKey).toBe(current.routeLegs[0].cacheKey);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("permits only one concurrent write against the same plan version", async () => {
    const current = await fixture();
    const results = await Promise.allSettled([
      routes.saveManualPlanRoute(current.tripId, current.versionNumber, input()),
      routes.saveManualPlanRoute(current.tripId, current.versionNumber, input({ fareCents: 800 })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await plans.listPlanVersions(current.tripId))[0].versionNumber).toBe(current.versionNumber + 1);
  });

  it("invalidates a changed location without retaining its old arrival or fare", async () => {
    let current = await fixture();
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, input());
    current = await plans.savePlanPlaceEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, eventId: "d1-breakfast", candidate: candidate("3"), precision: "poi" });
    expect(current.routeLegs[0]).toMatchObject({ arrivalTime: null, manualReference: { requiresReconfirmation: true, fareCents: 600 } });
    expect(current.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
  });

  it("never labels Amap transit as verified future timetable support", async () => {
    let current = await fixture();
    const record = await settings.getSettingsRecord();
    vi.spyOn(settings, "getSettingsRecord").mockResolvedValue({ ...record, mapProvider: "amap" });
    vi.spyOn(mapSettings, "getMapConfiguration").mockResolvedValue({ browserKey: "synthetic-browser", webServiceKey: "synthetic-service", securityCode: "synthetic-security" });
    const fetchMock = vi.fn(async () => Response.json({
      status: "1", route: { transits: [{ duration: "2700", walking_distance: "600", cost: "6", segments: [{
        walking: { distance: "600", duration: "600", steps: [] },
        bus: { buslines: [{ name: "测试 1 号线", type: "地铁", departure_stop: { name: "A 站" }, arrival_stop: { name: "B 站" }, duration: "1800", polyline: "112.97,28.19;112.98,28.19" }] },
      }] }] },
    }));
    vi.stubGlobal("fetch", fetchMock);
    current = await routes.searchAndSavePlanRoute(current.tripId, current.versionNumber, { fromEventId: "d1-breakfast", toEventId: "d1-activity", mode: "public_transit", departureTime: "08:45" });
    expect(current.routeLegs[0]).toMatchObject({ status: "pending_confirmation", futureQueryCapability: false, candidateRecheck: { attempts: 1, status: "not_applicable" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
