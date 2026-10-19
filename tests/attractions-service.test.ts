import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { attractionCatalog } from "../lib/attraction-catalog";
import { validatePlan } from "../lib/plan";
import { clearRouteCache, manualReferenceRoute, type RouteLeg } from "../lib/routes";
import type { PlaceCandidate } from "../lib/places";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { buildPlanRedlines } from "../lib/redline-service";

let database: ReturnType<typeof isolatedDatabase>;
let db: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");
let service: typeof import("../lib/attraction-service");
let settings: typeof import("../lib/settings");
let evidence: typeof import("../lib/evidence-service");
let maps: typeof import("../lib/map-settings");

beforeAll(async () => {
  database = isolatedDatabase("unit-attractions");
  db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service"); service = await import("../lib/attraction-service");
  settings = await import("../lib/settings"); evidence = await import("../lib/evidence-service"); maps = await import("../lib/map-settings");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearRouteCache(); });
afterAll(async () => {
  await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), settings?.closeSettingsStore(), evidence?.closeEvidenceStore(), maps?.closeMapSettingsStore(), db?.$disconnect()]);
  database?.cleanup();
});

async function fixture(options: { routes?: boolean; currentMuseum?: boolean; relaxed?: boolean; walking?: boolean; redline?: boolean; constraints?: string[] } = {}) {
  const trip = await trips.createTrip({ originalRequest: "隔离测试：景点图片与原子替换" });
  const request = requestFixture(2, { pace: options.relaxed ? "relaxed" : "balanced", ...(options.constraints ? { constraints: options.constraints } : {}) });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision);
  const content = planFixture(capture.requestSnapshot);
  // Begin within the test cap; the candidate must be what exceeds it.
  if (options.constraints?.some((text) => /预算/.test(text))) content.events.forEach((event) => { event.costDraftCents = 0; });
  if (options.redline) {
    for (const [id, startTime, endTime] of [["d2-activity", "10:00", "11:00"], ["d2-lunch", "09:00", "09:30"], ["d2-rest", "09:30", "09:45"], ["return", "13:00", "14:30"]]) {
      const event = content.events.find((item) => item.id === id)!;
      Object.assign(event, { startTime, endTime });
    }
  }
  let plan = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
  if (options.currentMuseum || options.routes) {
    const museum = attractionCatalog.find((entry) => entry.id === "hunan-museum")!;
    plan = await plans.savePlanPlaceEdit({ tripId: trip.id, expectedPlanVersion: plan.versionNumber, eventId: "d1-activity", candidate: museum.location!, precision: "poi" });
  }
  if (options.routes) {
    for (const [eventId, poiId, longitude] of [["d1-breakfast", "1", 112.972], ["d1-lunch", "2", 112.974]] as const) {
      const candidate: PlaceCandidate = { provider: "osm", poiId, name: `隔离测试地点${poiId}`, city: "长沙", district: "", address: "", adcode: "", category: "test", longitude, latitude: 28.19, coordinateSystem: "WGS84", retrievedAt: new Date().toISOString() };
      plan = await plans.savePlanPlaceEdit({ tripId: trip.id, expectedPlanVersion: plan.versionNumber, eventId, candidate, precision: "poi" });
    }
    for (const [fromEventId, toEventId, departureTime] of [["d1-breakfast", "d1-activity", "08:30"], ["d1-activity", "d1-lunch", "12:00"]]) {
      const manual = manualReferenceRoute({ tripId: trip.id, date: request.startDate!, edit: { fromEventId, toEventId, departureTime,
        manualReference: { availability: "available", instructions: "隔离路线样例", durationMinutes: 10, fareCents: 1600, sourceName: "隔离测试", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true } } });
      const route: RouteLeg = { ...manual, mode: options.walking ? "walking" : "driving", status: "estimated", manualReference: undefined,
        distanceMeters: 800, polyline: [{ longitude: 112.97, latitude: 28.19 }, { longitude: 112.98, latitude: 28.20 }],
        includedTimes: [options.walking ? "walking" : "driving"] };
      plan = await plans.savePlanRouteEdit({ tripId: trip.id, expectedPlanVersion: plan.versionNumber, route });
    }
  }
  return plan;
}

function routeResponse(duration = 600, distance = 1200) {
  return new Response(JSON.stringify({ code: "Ok", routes: [{ duration, distance, geometry: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", legs: [{ steps: [{ name: "隔离测试道路", duration, distance, maneuver: { type: "depart" } }] }] }] }), { status: 200 });
}

describe("atomic attraction choice", () => {
  it("keeps only a user choice, is idempotent, and never confirms reservations or prices", async () => {
    const plan = await fixture({ currentMuseum: true });
    const saved = await service.keepPlanAttraction(plan.tripId, plan.versionNumber, "d1-activity", "hunan-museum");
    const before = plan.events.find((event) => event.id === "d1-activity")!;
    expect(saved.events.find((event) => event.id === before.id)).toEqual({ ...before, attractionSelection: expect.objectContaining({ action: "keep", catalogId: "hunan-museum" }) });
    expect(saved.costs).toEqual(plan.costs); expect(saved.routeLegs).toEqual(plan.routeLegs);
    const again = await service.keepPlanAttraction(saved.tripId, saved.versionNumber, before.id, "hunan-museum");
    expect(again.id).toBe(saved.id);
    await expect(service.keepPlanAttraction(plan.tripId, plan.versionNumber, before.id)).rejects.toThrow("历史版本");
    expect((await service.getPlanAttractions(plan.tripId, plan.versionNumber, before.id)).readOnly).toBe(true);
  });

  it("previews without a write then changes place, time, cost, both existing routes and evidence in exactly one new version", async () => {
    const plan = await fixture({ routes: true });
    await db.evidenceFact.create({ data: { tripId: plan.tripId, planVersionId: plan.id, targetType: "event", targetId: "d1-activity", field: "location", status: "verified", evaluationVersion: 1,
      sourceTitle: "原地点测试证据", sourceUrl: "https://www.hnmuseum.com/", sourcePublisher: "测试", sourceDateStatus: "applicable", extractedValue: "湖南博物院", searchProvider: "test", searchQuery: "test",
      retrievedAt: new Date(), applicableFrom: new Date(), applicableUntil: new Date(Date.now() + 90 * 86400_000), contentQuote: "原地点证据，仅供隔离测试", lastRefreshStatus: "success" } });
    const fetchMock = vi.fn(async () => routeResponse()); vi.stubGlobal("fetch", fetchMock);
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy");
    expect(preview.canApply).toBe(true); expect(preview.conflicts).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(plan.id);
    const saved = await service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", preview.previewToken);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(saved.versionNumber).toBe(plan.versionNumber + 1);
    expect(saved.events.find((event) => event.id === "d1-activity")).toMatchObject({ title: "岳麓书院", locationName: "岳麓书院", endTime: "11:30", status: "suggested", costStatus: "pending_confirmation" });
    const newPlaceId = saved.events.find((event) => event.id === "d1-activity")!.placeId;
    expect(saved.places.find((place) => place.id === newPlaceId)?.poiId).toBe(attractionCatalog.find((entry) => entry.id === "yuelu-academy")!.location!.poiId);
    expect(saved.routeLegs.find((route) => route.fromEventId === "d1-activity")).toMatchObject({ departureTime: "11:30", durationSeconds: 600, arrivalTime: "11:40" });
    expect(saved.costs.find((cost) => cost.id === "cost-d1-activity")).toMatchObject({ unit: "per_person", unitAmountCents: 4000, certainty: "pending_confirmation" });
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(2);
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-")).every((cost) => cost.unitAmountCents === null)).toBe(true);
    expect((await evidence.listEvidenceFacts(plan.tripId)).find((fact) => fact.planVersionId === saved.id)).toMatchObject({ lastRefreshStatus: "needs_review", effectiveStatus: "stale" });
    expect((await plans.getPlanVersion(saved.tripId, saved.versionNumber)).events).toEqual(saved.events);
    expect((await plans.getPlanVersion(plan.tripId, plan.versionNumber)).routeLegs).toEqual(plan.routeLegs);
    await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", preview.previewToken)).rejects.toThrow("预览已失效");
  });

  it("keeps unknown attraction price and failed-route costs unknown without stale geometry", async () => {
    const plan = await fixture({ routes: true });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("test service unavailable"); }));
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "orange-isle");
    expect(preview.canApply).toBe(true);
    const saved = await service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "orange-isle", preview.previewToken);
    expect(saved.costs.find((cost) => cost.id === "cost-d1-activity")?.unitAmountCents).toBeNull();
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(2);
    expect(saved.routeLegs.every((route) => route.durationSeconds === null && route.distanceMeters === null && route.polyline.length === 0)).toBe(true);
    expect(saved.places.find((place) => place.poiId === "relation:16734076")?.precision).toBe("area_reference");
    expect(saved.validationResults.warnings.join(" ")).toContain("精确游览入口待确认");
  });

  it("does not apply the old venue's copied closure, price or booking rules to its replacement", async () => {
    const plan = await fixture({ currentMuseum: true });
    const event = plan.events.find((item) => item.id === "d1-activity")!;
    for (const [field, extractedValue] of [["opening_hours", "闭馆"], ["price", "旧馆99元"], ["reservation", "not_required"]]) {
      await db.evidenceFact.create({ data: { tripId: plan.tripId, planVersionId: plan.id, targetType: "event", targetId: event.id, field,
        status: field === "opening_hours" ? "conflict" : "verified", evaluationVersion: 1,
        sourceTitle: "原馆资料（隔离测试）", sourceUrl: "https://www.hnmuseum.com/", sourcePublisher: "测试", sourceDateStatus: "applicable",
        extractedValue, searchProvider: "test", searchQuery: "test", retrievedAt: new Date(),
        applicableFrom: new Date(`${event.date}T00:00:00+08:00`), applicableUntil: new Date(`${event.date}T23:59:59+08:00`),
        contentQuote: "旧馆99元，无需预约，本次到访日闭馆", lastRefreshStatus: "success", conflictReason: field === "opening_hours" ? "本次到访日闭馆" : null } });
    }
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, event.id, "yuelu-academy");
    expect(preview.canApply).toBe(true);
    const saved = await service.applyAttractionReplacement(plan.tripId, plan.versionNumber, event.id, "yuelu-academy", preview.previewToken);
    const { current } = await service.getPlanAttractions(saved.tripId, saved.versionNumber, event.id);
    expect(current?.eligibility).toBe("pending");
    expect(current?.ticket).toMatchObject({ minCents: 4000, status: "pending" });
    expect(current?.ticket.text).not.toContain("旧馆");
    expect(current?.reservation.required).toBe(true);
    expect(current?.warnings.join(" ")).toContain("未作为当前景点依据");
    expect(current?.sources.some((source) => source.title === "原馆资料（隔离测试）")).toBe(false);
    expect((await evidence.listEvidenceFacts(plan.tripId)).filter((fact) => fact.planVersionId === saved.id)).toHaveLength(3);
  });

  it("blocks schedule/route conflicts and leaves the old plan untouched", async () => {
    const plan = await fixture({ relaxed: true });
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "hunan-museum");
    expect(preview.canApply).toBe(false); expect(preview.conflicts.join(" ")).toContain("重叠");
    await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "hunan-museum", preview.previewToken)).rejects.toThrow("重叠");
    expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(plan.id);
    const routed = await fixture({ routes: true });
    vi.stubGlobal("fetch", vi.fn(async () => routeResponse(4 * 3600)));
    const late = await service.previewAttractionReplacement(routed.tripId, routed.versionNumber, "d1-activity", "yuelu-academy");
    expect(late.canApply).toBe(false); expect(late.conflicts.join(" ")).toContain("晚于下一项");
  });

  it("rejects stale, foreign, expired and cancelled previews without an extra saved version", async () => {
    const plan = await fixture();
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy");
    await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d2-activity", "yuelu-academy", preview.previewToken)).rejects.toThrow("预览已失效");
    await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", preview.previewToken, AbortSignal.abort())).rejects.toThrow("已取消");
    const kept = await service.keepPlanAttraction(plan.tripId, plan.versionNumber, "d1-activity");
    await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", preview.previewToken)).rejects.toThrow("计划已变化");
    expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(kept.id);
    const current = await fixture();
    const expires = await service.previewAttractionReplacement(current.tripId, current.versionNumber, "d1-activity", "yuelu-academy");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(expires.expiresAt) + 1);
    await expect(service.applyAttractionReplacement(current.tripId, current.versionNumber, "d1-activity", "yuelu-academy", expires.previewToken)).rejects.toThrow("预览已失效");
  });

  it("rejects a cancelled late route response and preserves paid/confirmed or locked activity facts", async () => {
    const plan = await fixture({ routes: true });
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); return routeResponse(); }));
    await expect(service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", controller.signal)).rejects.toThrow("已取消");
    expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(plan.id);
    const paid = await plans.savePlanCostEdit({ tripId: plan.tripId, expectedPlanVersion: plan.versionNumber, edit: { costId: "cost-d1-activity", unit: "per_person", unitAmountCents: 9000, unitAmountMaxCents: null, quantity: null, paymentStatus: "paid" } });
    await expect(service.previewAttractionReplacement(paid.tripId, paid.versionNumber, "d1-activity", "yuelu-academy")).rejects.toThrow("付款");
    const kept = await service.keepPlanAttraction(paid.tripId, paid.versionNumber, "d1-activity"); expect(kept.costs).toEqual(paid.costs);
    const locked = await plans.savePlanEventEdit({ tripId: kept.tripId, expectedPlanVersion: kept.versionNumber, edit: { eventId: "d1-activity", timeEdit: "preserve", note: "已确定预约安排", status: "confirmed", locked: true, remove: false } });
    await expect(service.previewAttractionReplacement(locked.tripId, locked.versionNumber, "d1-activity", "yuelu-academy")).rejects.toThrow("锁定或确认");
  });

  it("inherits the old request snapshot when the latest request changed and resolves concurrent apply to one version", async () => {
    const plan = await fixture();
    await requests.saveRequestDraft(plan.tripId, { expectedRequestRevision: plan.requestRevision, request: { ...plan.requestSnapshot, destination: "北京", interests: ["购物"] } });
    const recommendations = await service.getPlanAttractions(plan.tripId, plan.versionNumber, "d1-activity");
    expect(recommendations.candidates.every((card) => card.city === "长沙")).toBe(true);
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy");
    const results = await Promise.allSettled([1, 2].map(() => service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", preview.previewToken)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const saved = (await plans.listPlanVersions(plan.tripId))[0];
    expect(saved.versionNumber).toBe(plan.versionNumber + 1);
    expect(saved.requestSnapshot).toEqual(plan.requestSnapshot); expect(saved.requirementUpToDate).toBe(false);
  });

  it("rolls back the event, place, routes, budget and evidence if the final current-version update fails", async () => {
    const plan = await fixture({ currentMuseum: true });
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy");
    const counts = { versions: await db.planVersion.count({ where: { tripId: plan.tripId } }), facts: await db.evidenceFact.count({ where: { tripId: plan.tripId } }) };
    // This trigger exists only in the isolated test database and simulates a
    // failure after the new version was created but before the transaction ends.
    await db.$executeRawUnsafe("CREATE TRIGGER attraction_test_abort BEFORE UPDATE OF currentPlanVersionId ON Trip BEGIN SELECT RAISE(ABORT, 'injected final update failure'); END");
    try {
      await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d1-activity", "yuelu-academy", preview.previewToken)).rejects.toThrow();
    } finally { await db.$executeRawUnsafe("DROP TRIGGER attraction_test_abort"); }
    expect(await db.planVersion.count({ where: { tripId: plan.tripId } })).toBe(counts.versions);
    expect(await db.evidenceFact.count({ where: { tripId: plan.tripId } })).toBe(counts.facts);
    const current = await plans.getPlanVersion(plan.tripId, plan.versionNumber);
    expect(current.isCurrent).toBe(true); expect(current.events).toEqual(plan.events);
    expect(current.places).toEqual(plan.places); expect(current.routeLegs).toEqual(plan.routeLegs); expect(current.costs).toEqual(plan.costs);
  });

  it("blocks a newly introduced computed fixed-transport redline without changing the confirmed ticket", async () => {
    let plan = await fixture({ redline: true });
    plan = await plans.savePlanTicketEdit({ tripId: plan.tripId, expectedPlanVersion: plan.versionNumber, action: { action: "activate", acknowledged: true,
      ticket: ticketFixture(plan.requestSnapshot.endDate!, { eventId: "return", direction: "return", departureTime: "13:00", arrivalTime: "14:30", arrivalDate: plan.requestSnapshot.endDate!,
        accessMode: "walking", accessDurationMinutes: 20, chainOriginName: "Example Museum" }) } });
    const baseline = await buildPlanRedlines(plan);
    expect(baseline[0].suggestedAt).not.toBeNull();
    expect(baseline[0].conflicts.some((message) => message.startsWith("上一项结束于"))).toBe(false);
    const preview = await service.previewAttractionReplacement(plan.tripId, plan.versionNumber, "d2-activity", "hunan-museum");
    expect(preview.conflicts.join(" ")).toContain("固定交通红线"); expect(preview.canApply).toBe(false);
    await expect(service.applyAttractionReplacement(plan.tripId, plan.versionNumber, "d2-activity", "hunan-museum", preview.previewToken)).rejects.toThrow("固定交通红线");
    expect((await plans.getPlanVersion(plan.tripId, plan.versionNumber)).tickets).toEqual(plan.tickets);
  });

  it("blocks known walking excess and a plain-language confirmed budget ceiling", async () => {
    const walking = await fixture({ routes: true, walking: true, constraints: ["每日步行不超过 1 公里"] });
    vi.stubGlobal("fetch", vi.fn(async () => routeResponse(600, 1200)));
    const preview = await service.previewAttractionReplacement(walking.tripId, walking.versionNumber, "d1-activity", "yuelu-academy");
    expect(preview.canApply).toBe(false); expect(preview.conflicts.join(" ")).toContain("每日步行上限");
    const budget = await fixture({ constraints: ["预算不超过 50 元。最好少走路"] });
    const overspend = await service.previewAttractionReplacement(budget.tripId, budget.versionNumber, "d1-activity", "yuelu-academy");
    expect(overspend.canApply).toBe(false); expect(overspend.conflicts.join(" ")).toContain("总预算上限");
  });
});
