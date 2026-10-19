import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MealPricing } from "../lib/restaurants";
import { restaurantCatalog } from "../lib/restaurant-catalog";
import { budgetFactorsFromSnapshot, costItemLineTotals } from "../lib/budget";
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
let service: typeof import("../lib/restaurant-service");
let settings: typeof import("../lib/settings");
let evidence: typeof import("../lib/evidence-service");
let maps: typeof import("../lib/map-settings");

beforeAll(async () => {
  database = isolatedDatabase("unit-restaurants");
  db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service"); service = await import("../lib/restaurant-service");
  settings = await import("../lib/settings"); evidence = await import("../lib/evidence-service"); maps = await import("../lib/map-settings");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearRouteCache(); });
afterAll(async () => {
  await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), settings?.closeSettingsStore(), evidence?.closeEvidenceStore(), maps?.closeMapSettingsStore(), db?.$disconnect()]);
  database?.cleanup();
});

const pricing = { dinerCount: 3, minCents: 1850, maxCents: 2550 };
async function fixture(options: { routes?: boolean; redline?: boolean; constraints?: string[] } = {}) {
  const trip = await trips.createTrip({ originalRequest: "隔离测试：餐厅与本餐人数" });
  const request = requestFixture(2, { ...(options.constraints ? { constraints: options.constraints } : {}) });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision), content = planFixture(capture.requestSnapshot);
  // Begin within the test cap; the candidate meal must be what exceeds it.
  if (options.constraints?.some((text) => /预算/.test(text))) content.events.forEach((event) => { event.costDraftCents = 0; });
  if (options.redline) {
    for (const [id, startTime, endTime] of [["d2-activity", "09:00", "09:30"], ["d2-lunch", "11:30", "11:45"], ["d2-rest", "09:30", "09:45"], ["return", "13:00", "14:30"]]) Object.assign(content.events.find((item) => item.id === id)!, { startTime, endTime });
  }
  let plan = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
  if (options.routes) {
    for (const [eventId, poiId, longitude] of [["d1-activity", "11", 112.972], ["d1-lunch", "12", 112.974], ["d1-rest", "13", 112.976]] as const) {
      const candidate: PlaceCandidate = { provider: "osm", poiId, name: `隔离测试地点${poiId}`, city: "长沙", district: "", address: "", adcode: "", category: "test", longitude, latitude: 28.19, coordinateSystem: "WGS84", retrievedAt: new Date().toISOString() };
      plan = await plans.savePlanPlaceEdit({ tripId: trip.id, expectedPlanVersion: plan.versionNumber, eventId, candidate, precision: "poi" });
    }
    for (const [fromEventId, toEventId, departureTime] of [["d1-activity", "d1-lunch", "12:00"], ["d1-lunch", "d1-rest", "13:30"]]) {
      const manual = manualReferenceRoute({ tripId: trip.id, date: request.startDate!, edit: { fromEventId, toEventId, departureTime,
        manualReference: { availability: "available", instructions: "隔离路线样例", durationMinutes: 10, fareCents: 1600, sourceName: "隔离测试", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true } } });
      const route: RouteLeg = { ...manual, mode: "driving", status: "estimated", manualReference: undefined,
        distanceMeters: 800, polyline: [{ longitude: 112.97, latitude: 28.19 }, { longitude: 112.98, latitude: 28.20 }], includedTimes: ["driving"] };
      plan = await plans.savePlanRouteEdit({ tripId: trip.id, expectedPlanVersion: plan.versionNumber, route });
    }
  }
  return plan;
}
function routeResponse(duration = 600) {
  return new Response(JSON.stringify({ code: "Ok", routes: [{ duration, distance: 1200, geometry: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", legs: [{ steps: [{ name: "隔离测试道路", duration, distance: 1200, maneuver: { type: "depart" } }] }] }] }), { status: 200 });
}
const preview = (plan: Awaited<ReturnType<typeof fixture>>, candidateId: string | null = null, values: MealPricing = pricing) => service.previewRestaurantEdit(plan.tripId, plan.versionNumber, "d1-lunch", candidateId, values);
const apply = (plan: Awaited<ReturnType<typeof fixture>>, token: string) => service.applyRestaurantEdit(plan.tripId, plan.versionNumber, "d1-lunch", token);

describe("restaurant preview and atomic persistence", () => {
  it("previews without writing and saves one meal's participants and range without changing other meals or routes", async () => {
    const plan = await fixture({ routes: true }), proposal = await preview(plan);
    expect(proposal.canApply).toBe(true); expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(plan.id);
    const saved = await apply(plan, proposal.previewToken), cost = saved.costs.find((item) => item.id === "cost-d1-lunch")!;
    expect(cost).toMatchObject({ unit: "per_person", dinerCount: 3, unitAmountCents: 1850, unitAmountMaxCents: 2550, certainty: "estimated", source: "ai_draft" });
    expect(costItemLineTotals(cost, budgetFactorsFromSnapshot(saved.requestSnapshot))).toMatchObject({ minCents: 5550, maxCents: 7650 });
    expect(saved.costs.filter((item) => item.id !== cost.id)).toEqual(plan.costs.filter((item) => item.id !== cost.id));
    expect(saved.routeLegs).toEqual(plan.routeLegs); expect(saved.places).toEqual(plan.places);
    expect(saved.requestSnapshot).toEqual(plan.requestSnapshot);
    expect((await plans.getPlanVersion(saved.tripId, saved.versionNumber)).costs).toEqual(saved.costs);
    await expect(apply(plan, proposal.previewToken)).rejects.toThrow("预览已失效");
  });
  it("replaces a meal, recalculates both legs and clears inherited old restaurant evidence", async () => {
    const plan = await fixture({ routes: true });
    const event = plan.events.find((item) => item.id === "d1-lunch")!;
    await db.evidenceFact.create({ data: { tripId: plan.tripId, planVersionId: plan.id, targetType: "event", targetId: event.id, field: "opening_hours", status: "conflict", evaluationVersion: 1,
      sourceTitle: "原店停业（隔离测试）", sourceUrl: "https://www.huogongdian.com/stores.html", sourcePublisher: "隔离测试", sourceDateStatus: "applicable", extractedValue: "关闭", searchProvider: "test", searchQuery: "test", retrievedAt: new Date(),
      applicableFrom: new Date(`${event.date}T00:00:00+08:00`), applicableUntil: new Date(`${event.date}T23:59:59+08:00`), contentQuote: "原店已关闭", lastRefreshStatus: "success", conflictReason: "原店已关闭" } });
    const fetchMock = vi.fn(async () => routeResponse()); vi.stubGlobal("fetch", fetchMock);
    const proposal = await preview(plan, "xinyuloudong-wanjiali");
    expect(proposal.canApply).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
    const saved = await apply(plan, proposal.previewToken);
    expect(saved.versionNumber).toBe(plan.versionNumber + 1);
    expect(saved.events.find((item) => item.id === event.id)).toMatchObject({ locationName: restaurantCatalog[2].name, endTime: "13:30", restaurantSelection: { catalogId: "xinyuloudong-wanjiali", action: "replace" } });
    expect(saved.routeLegs).toHaveLength(2); expect(saved.routeLegs.every((route) => route.durationSeconds === 600 && route.polyline.length > 0)).toBe(true);
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-")).every((cost) => cost.unitAmountCents === null)).toBe(true);
    const result = await service.getPlanRestaurants(saved.tripId, saved.versionNumber, event.id);
    expect(result.current?.eligibility).toBe("pending"); expect(result.current?.warnings.join(" ")).toContain("旧摘录未用于");
    expect((await evidence.listEvidenceFacts(plan.tripId)).find((fact) => fact.planVersionId === saved.id)?.lastRefreshStatus).toBe("needs_review");
  });
  it("a restaurant with no precise POI clears both old paths and keeps unknown journey costs", async () => {
    const plan = await fixture({ routes: true }), proposal = await preview(plan, "huogongdian-pozi", { dinerCount: 1, minCents: null, maxCents: null });
    expect(proposal.canApply).toBe(true);
    const saved = await apply(plan, proposal.previewToken);
    expect(saved.events.find((event) => event.id === "d1-lunch")!.placeId).toBeNull();
    expect(saved.routeLegs).toHaveLength(2); expect(saved.routeLegs.every((route) => route.durationSeconds === null && route.polyline.length === 0)).toBe(true);
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-"))).toHaveLength(2);
    expect(saved.costs.filter((cost) => cost.id.startsWith("route-")).every((cost) => cost.unitAmountCents === null)).toBe(true);
    expect(proposal.afterBudget.unknownItemCount).toBeGreaterThan(proposal.beforeBudget.unknownItemCount);
  });
  it("route failures clear old results; late routes and explicit budget excess block application", async () => {
    const plan = await fixture({ routes: true }); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const failed = await preview(plan, "xinyuloudong-wanjiali"); expect(failed.canApply).toBe(true); expect(failed.card?.outgoingRoute?.durationSeconds).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => routeResponse(7200)));
    const late = await preview(plan, "xinyuloudong-wanjiali"); expect(late.canApply).toBe(false); expect(late.conflicts.join(" ")).toContain("晚于下一项");
    await expect(apply(plan, late.previewToken)).rejects.toThrow();
    const limited = await fixture({ constraints: ["最好少走路，总预算控制在10元以内"] }); expect((await preview(limited)).canApply).toBe(false);
    expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(plan.id);
  });
  it("protects paid and locked meals, rejects old versions, other trips and cancelled/expired tokens", async () => {
    const plan = await fixture(), proposal = await preview(plan), other = await fixture();
    await expect(apply(other, proposal.previewToken)).rejects.toThrow("失效");
    await expect(service.applyRestaurantEdit(plan.tripId, plan.versionNumber, "d1-lunch", proposal.previewToken, AbortSignal.abort())).rejects.toThrow("取消");
    const paid = await plans.savePlanCostEdit({ tripId: plan.tripId, expectedPlanVersion: plan.versionNumber, edit: { costId: "cost-d1-lunch", unit: "per_person", unitAmountCents: 3000, unitAmountMaxCents: null, quantity: null, paymentStatus: "paid" } });
    await expect(preview(paid)).rejects.toThrow("已支付"); await expect(apply(plan, proposal.previewToken)).rejects.toThrow("计划已变化");
    const locked = await plans.savePlanEventEdit({ tripId: other.tripId, expectedPlanVersion: other.versionNumber, edit: { eventId: "d1-lunch", timeEdit: "preserve", locked: true, status: "confirmed", note: "已确定用餐", remove: false } });
    await expect(preview(locked)).rejects.toThrow("锁定或确认");
    const expiring = await fixture(), cached = await preview(expiring);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(cached.expiresAt) + 1); await expect(apply(expiring, cached.previewToken)).rejects.toThrow("失效");
  });
  it("keeps request snapshots and allows only one concurrent apply", async () => {
    const plan = await fixture();
    await requests.saveRequestDraft(plan.tripId, { expectedRequestRevision: plan.requestRevision, request: { ...plan.requestSnapshot, travelerCount: 5, destination: "北京" } });
    const proposal = await preview(plan), results = await Promise.allSettled([1, 2].map(() => apply(plan, proposal.previewToken)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const saved = (await plans.listPlanVersions(plan.tripId))[0]; expect(saved.requestSnapshot).toEqual(plan.requestSnapshot); expect(saved.requirementUpToDate).toBe(false);
    expect(saved.costs.find((cost) => cost.id === "cost-d1-lunch")?.dinerCount).toBe(3);
  });
  it("rolls back everything if updating the current version fails", async () => {
    const plan = await fixture(), proposal = await preview(plan, "xinyuloudong-wanjiali"), count = await db.planVersion.count({ where: { tripId: plan.tripId } });
    await db.$executeRawUnsafe("CREATE TRIGGER restaurant_abort BEFORE UPDATE OF currentPlanVersionId ON Trip BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    try { await expect(apply(plan, proposal.previewToken)).rejects.toThrow(); } finally { await db.$executeRawUnsafe("DROP TRIGGER restaurant_abort"); }
    expect(await db.planVersion.count({ where: { tripId: plan.tripId } })).toBe(count);
    const current = await plans.getPlanVersion(plan.tripId, plan.versionNumber); expect(current.isCurrent).toBe(true); expect(current.events).toEqual(plan.events); expect(current.costs).toEqual(plan.costs);
  });
  it("does not apply a cancelled late route result", async () => {
    const plan = await fixture({ routes: true }), controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); return routeResponse(); }));
    await expect(service.previewRestaurantEdit(plan.tripId, plan.versionNumber, "d1-lunch", "xinyuloudong-wanjiali", pricing, controller.signal)).rejects.toThrow("取消");
    expect((await plans.listPlanVersions(plan.tripId))[0].id).toBe(plan.id);
  });
  it("checks the extended meal against a fixed train redline without moving the ticket", async () => {
    let plan = await fixture({ redline: true });
    plan = await plans.savePlanTicketEdit({ tripId: plan.tripId, expectedPlanVersion: plan.versionNumber, action: { action: "activate", acknowledged: true,
      ticket: ticketFixture(plan.requestSnapshot.endDate!, { eventId: "return", direction: "return", departureTime: "13:00", arrivalTime: "14:30", arrivalDate: plan.requestSnapshot.endDate!, accessMode: "walking", accessDurationMinutes: 20, chainOriginName: "公共集合点" }) } });
    const baseline = await buildPlanRedlines(plan); expect(baseline[0].conflicts.some((message) => message.startsWith("上一项结束于"))).toBe(false);
    const proposal = await service.previewRestaurantEdit(plan.tripId, plan.versionNumber, "d2-lunch", "huogongdian-pozi", pricing);
    expect(proposal.canApply, JSON.stringify({baseline:baseline[0].suggestedAt, changes:proposal.changes, warnings:proposal.warnings})).toBe(false); expect(proposal.conflicts.join(" ")).toContain("固定交通红线");
    expect((await plans.getPlanVersion(plan.tripId, plan.versionNumber)).tickets).toEqual(plan.tickets);
  });
  it("invalidates the old restaurant's manual access timing without altering the confirmed ticket", async () => {
    let plan = await fixture();
    plan = await plans.savePlanTicketEdit({ tripId: plan.tripId, expectedPlanVersion: plan.versionNumber, action: { action: "activate", acknowledged: true,
      ticket: ticketFixture(plan.requestSnapshot.endDate!, { eventId: "return", direction: "return", departureTime: "17:00", arrivalTime: "18:30", arrivalDate: plan.requestSnapshot.endDate!, accessMode: "walking", accessDurationMinutes: 20, chainOriginName: "午餐" }) } });
    expect((await buildPlanRedlines(plan))[0].suggestedAt).not.toBeNull();
    const proposal = await service.previewRestaurantEdit(plan.tripId, plan.versionNumber, "d2-lunch", "huogongdian-pozi", pricing);
    expect(proposal.warnings.join(" ")).toContain("旧餐厅耗时不再适用");
    const saved = await service.applyRestaurantEdit(plan.tripId, plan.versionNumber, "d2-lunch", proposal.previewToken);
    expect(saved.tickets).toEqual(plan.tickets);
    const lines = await buildPlanRedlines(saved); expect(lines[0].suggestedAt).toBeNull(); expect(lines[0].input.route.durationSeconds).toBeNull();
    const resolved = { ...saved, tickets: saved.tickets.map((ticket) => ({ ...ticket, chainOriginName: "已重新确认的集合点" })) };
    expect((await buildPlanRedlines(resolved))[0].input.blockers).not.toContain("原接驳起点的餐厅已替换，请更新门到门起点并重新核对接驳；旧餐厅耗时不再适用。");
  });
});
