import { readInstanceState } from "../scripts/restore-core.mjs";
import { getDatabasePath } from "../lib/data-directory";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSignedPayload } from "../lib/security";
import type { StayInput } from "../lib/accommodations";
import { buildMapMarkers, buildMapRoutes } from "../lib/map-link";
import { routeDayEvents } from "../lib/route-day";
import { clearRouteCache } from "../lib/routes";
import { validatePlan } from "../lib/plan";
import { calculateBudgetSummary } from "../lib/budget";
import type { PlaceCandidate } from "../lib/places";
import { ticketRedlineInput } from "../lib/redline-service";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";

let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service"), plans: typeof import("../lib/plan-service"), service: typeof import("../lib/accommodation-service"), settings: typeof import("../lib/settings"), evidence: typeof import("../lib/evidence-service"), execution: typeof import("../lib/execution-service");
beforeAll(async () => { database = isolatedDatabase("unit-accommodations"); db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } }); trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service"); service = await import("../lib/accommodation-service"); settings = await import("../lib/settings"); evidence = await import("../lib/evidence-service"); execution = await import("../lib/execution-service"); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearRouteCache(); });
afterAll(async () => { await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), settings?.closeSettingsStore(), evidence?.closeEvidenceStore(), execution?.closeExecutionStore(), db?.$disconnect()]); database?.cleanup(); });
const candidate = (id: string, name = "测试酒店"): PlaceCandidate => ({ provider: "osm", poiId: id, name, city: "长沙", district: "", address: "隔离测试地址", adcode: "", category: "tourism:hotel", longitude: 112.97, latitude: 28.19, coordinateSystem: "WGS84", retrievedAt: new Date().toISOString() });
async function fixture(days = 3, located = false) {
  const trip = await trips.createTrip({ originalRequest: "隔离住宿测试" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture(days) });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision), content = planFixture(capture.requestSnapshot);
  let p = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
  if (located) for (const [eventId, id, name] of [["d1-activity", "11", "当天活动"], ["d2-activity", "12", "次日活动"], ["return", "13", "返程站"]]) p = await plans.savePlanPlaceEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, eventId, candidate: candidate(id, name), precision: "poi" });
  return p;
}
type Plan = Awaited<ReturnType<typeof fixture>>;
const values = (p: Plan, overrides: Partial<StayInput> = {}): StayInput => ({ areaId: "today", kind: "area", hotelToken: null, routeMode: "walking", checkIn: p.requestSnapshot.startDate!, checkOut: p.requestSnapshot.endDate!, roomCount: 3, minCents: 18050, maxCents: 22050, morningDepartureTime: "07:00", checkInFrom: "14:00", checkOutBy: "12:00", luggageStorage: "unknown", conditionNote: "测试资料", acknowledged: true, ...overrides });
const token = (p: Plan, hotel = candidate("77")) => createSignedPayload({ scope: "place-selection", dataGeneration: readInstanceState(getDatabasePath()).dataGeneration, tripId: p.tripId, version: p.versionNumber, eventId: "d1-hotel", candidate: hotel, exp: Date.now() + 60_000 });
const preview = (p: Plan, overrides: Partial<StayInput> = {}) => service.previewAccommodation(p.tripId, p.versionNumber, "d1-hotel", values(p, overrides));
const apply = (p: Plan, t: string) => service.applyAccommodation(p.tripId, p.versionNumber, "d1-hotel", t);
function mockRoute(seconds = 600) { vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "Ok", routes: [{ duration: seconds, distance: 800, geometry: "_p~iF~ps|U_ulLnnqC_mqNvxq`@", legs: [{ steps: [{ name: "测试道路", duration: seconds, distance: 800, maneuver: { type: "depart" } }] }] }] })))); }
describe("住宿确认服务", () => {
  it("previews without saving and persists two nights with explicit room counts in one new version", async () => {
    const p = await fixture(), proposal = await preview(p); expect(proposal.canApply).toBe(true);
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(1);
    const saved = await apply(p, proposal.previewToken), costs = saved.costs.filter((c) => c.category === "accommodation");
    expect(saved.versionNumber).toBe(2); expect(costs).toHaveLength(2); expect(costs.every((c) => c.roomCount === 3 && c.nightCount === 1 && c.certainty === "estimated")).toBe(true);
    expect(calculateBudgetSummary(costs, saved.requestSnapshot).totalMinCents).toBe(108300);
    expect(saved.events.filter((e) => e.type === "accommodation").every((e) => e.accommodationSelection?.kind === "area" && e.accommodationSelection.nightCount === 2 && e.placeId === null)).toBe(true);
    expect((await plans.getPlanVersion(p.tripId, 2)).events).toEqual(saved.events);
    await expect(apply(p, proposal.previewToken)).rejects.toThrow("过期");
  });
  it("blocks an unlocated area with 11:00 departure before a 10:00 activity even though checkout is 12:00", async () => {
    const p = await fixture(2), proposal = await preview(p, { morningDepartureTime: "11:00", checkOutBy: "12:00" });
    expect(p.places).toEqual([]);
    expect(proposal.canApply).toBe(false);
    expect(proposal.conflicts.join()).toContain("计划11:00从住宿离店");
    expect(proposal.conflicts.join()).toContain("Example Museum的开始时刻10:00");
    await expect(apply(p, proposal.previewToken)).rejects.toThrow("计划11:00");
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(1);
    expect(await plans.getPlanVersion(p.tripId, p.versionNumber)).toEqual(p);
  });
  it("retains a saved daily departure boundary during later ordinary timeline edits", async () => {
    const p = await fixture(2), proposal = await preview(p), saved = await apply(p, proposal.previewToken);
    await expect(plans.savePlanEventEdit({ tripId: saved.tripId, expectedPlanVersion: saved.versionNumber,
      edit: { eventId: "d2-activity", timeEdit: "start_duration", startTime: "06:30", durationMinutes: 30, note: null, status: "suggested", locked: false, remove: false },
    })).rejects.toThrow("计划07:00从住宿离店");
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(2);
    expect((await plans.getPlanVersion(p.tripId, saved.versionNumber)).events).toEqual(saved.events);
  });
  it.each(["current", "arrived", "completed"])("blocks a multi-night stay when a related night's execution is %s", async (status) => {
    const p = await fixture();
    await execution.saveExecution(p.tripId, { expectedRevision: 0, expectedPlanVersion: p.versionNumber, change: { action: "start", eventId: "d2-hotel" } });
    if (status !== "current") await execution.saveExecution(p.tripId, { expectedRevision: 1, expectedPlanVersion: p.versionNumber, change: { action: status === "arrived" ? "arrive" : "complete", eventId: "d2-hotel" } });
    const proposal = await preview(p);
    expect(proposal.canApply).toBe(false);
    expect(proposal.conflicts.join()).toContain("当前、已到达或已完成的住宿");
    await expect(apply(p, proposal.previewToken)).rejects.toThrow("住宿");
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(1);
  });
  it("rejects a previously applicable stay when execution changes after preview", async () => {
    const p = await fixture(2), proposal = await preview(p);
    expect(proposal.canApply).toBe(true);
    await execution.saveExecution(p.tripId, { expectedRevision: 0, expectedPlanVersion: p.versionNumber, change: { action: "start", eventId: "d1-hotel" } });
    await execution.saveExecution(p.tripId, { expectedRevision: 1, expectedPlanVersion: p.versionNumber, change: { action: "complete", eventId: "d1-hotel" } });
    const before = await execution.getExecution(p.tripId);
    await expect(apply(p, proposal.previewToken)).rejects.toThrow("执行进度");
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(1);
    expect((await execution.getExecution(p.tripId)).execution).toEqual(before.execution);
  });
  it("area references have no exact routes; selecting a real hotel calculates evening and next morning routes, fees and map", async () => {
    let p = await fixture(2, true); const area = await preview(p); p = await apply(p, area.previewToken);
    expect(p.places.find((v) => v.id === p.events.find((e) => e.id === "d1-hotel")!.placeId)?.precision).toBe("area_reference");
    expect(p.routeLegs.every((r) => r.durationSeconds === null)).toBe(true);
    mockRoute(); const proposal = await preview(p, { kind: "hotel", hotelToken: token(p), routeMode: "driving" });
    expect(proposal.canApply).toBe(true); expect(proposal.routes.filter((r) => r.durationSeconds === 600)).toHaveLength(2);
    const saved = await apply(p, proposal.previewToken), morning = saved.routeLegs.find((r) => r.fromEventId === "d1-hotel")!;
    expect(morning).toMatchObject({ date: saved.requestSnapshot.endDate, departureTime: "07:00", durationSeconds: 600 });
    const markers = buildMapMarkers(routeDayEvents(saved.events, saved.requestSnapshot.endDate!), saved.places);
    const ordinary = buildMapMarkers(saved.events.filter((e) => e.date === saved.requestSnapshot.endDate), saved.places);
    expect(markers.flatMap((m) => m.events).find((e) => e.id === "d2-activity")?.visitNumber).toBe(ordinary.flatMap((m) => m.events).find((e) => e.id === "d2-activity")?.visitNumber);
    expect(markers.flatMap((m) => m.events).find((e) => e.id === "d1-hotel")?.visitLabel).toBe("宿");
    expect(buildMapRoutes(saved.routeLegs, markers)).toHaveLength(1);
    expect(saved.costs.filter((c) => c.id.startsWith("route-")).length).toBe(2);
    const changed = await plans.savePlanEventEdit({ tripId: saved.tripId, expectedPlanVersion: saved.versionNumber, edit: { eventId: "d2-activity", timeEdit: "start_duration", startTime: "11:00", durationMinutes: 60, note: null, status: "suggested", locked: false, remove: false } });
    expect(changed.routeLegs.find((r) => r.fromEventId === "d1-hotel")?.durationSeconds).toBeNull();
  });
  it("route failure keeps unknown costs, while long journeys block a late next-day arrival", async () => {
    const p = await fixture(2, true); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const failed = await preview(p, { kind: "hotel", hotelToken: token(p), routeMode: "driving" }); expect(failed.canApply).toBe(true);
    const saved = await apply(p, failed.previewToken); expect(saved.costs.filter((c) => c.id.startsWith("route-")).every((c) => c.unitAmountCents === null)).toBe(true);
    mockRoute(4 * 3600); const late = await preview(saved, { kind: "hotel", hotelToken: token(saved) }); expect(late.canApply).toBe(false); expect(late.conflicts.join()).toContain("晚于下一项");
  });
  it("rejects wrong-city/area/foreign/expired hotel tokens and protects paid or locked stays", async () => {
    const p = await fixture(2);
    await expect(preview(p, { kind: "hotel", hotelToken: token(p, { ...candidate("77"), city: "北京" }) })).rejects.toThrow("城市");
    await expect(preview(p, { kind: "hotel", hotelToken: token(p, { ...candidate("77"), category: "place:suburb" }) })).rejects.toThrow("区域中点");
    const other = await fixture(2); await expect(preview(other, { kind: "hotel", hotelToken: token(p) })).rejects.toThrow("候选过期");
    const paid = await plans.savePlanCostEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, edit: { costId: "cost-d1-hotel", unit: "one_time", unitAmountCents: 10000, unitAmountMaxCents: null, quantity: null, paymentStatus: "paid" } });
    await expect(preview(paid)).rejects.toThrow("已支付");
    const locked = await plans.savePlanEventEdit({ tripId: other.tripId, expectedPlanVersion: other.versionNumber, edit: { eventId: "d1-hotel", timeEdit: "preserve", locked: true, status: "suggested", note: null, remove: false } }); await expect(preview(locked)).rejects.toThrow("锁定");
  });
  it("retains old request snapshots, rejects partial stay splits and allows only one concurrent apply", async () => {
    const p = await fixture(), proposal = await preview(p);
    const results = await Promise.allSettled([apply(p, proposal.previewToken), apply(p, proposal.previewToken)]); expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = (await plans.listPlanVersions(p.tripId))[0]; await expect(preview(saved, { checkOut: saved.events.find((e) => e.id === "d2-hotel")!.date })).rejects.toThrow("一部分");
    await requests.saveRequestDraft(p.tripId, { expectedRequestRevision: p.requestRevision, request: { ...p.requestSnapshot, destination: "北京", travelerCount: 9 } });
    const change = await preview(saved, { roomCount: 2 }), result = await apply(saved, change.previewToken); expect(result.requestSnapshot).toEqual(p.requestSnapshot); expect(result.requirementUpToDate).toBe(false);
    await expect(plans.savePlanPlaceEdit({ tripId: result.tripId, expectedPlanVersion: result.versionNumber, eventId: "d1-hotel", candidate: candidate("78"), precision: "poi" })).rejects.toThrow("住宿推荐");
    await expect(plans.savePlanCostEdit({ tripId: result.tripId, expectedPlanVersion: result.versionNumber, edit: { costId: "cost-d1-hotel", unit: "per_room_per_night", nightCount: 2, unitAmountCents: 10000, unitAmountMaxCents: null, quantity: null, paymentStatus: "not_paid" } })).rejects.toThrow("仅计一晚");
  });
  it("rolls back all related events and costs on a commit failure and cancels a late preview", async () => {
    const p = await fixture(), proposal = await preview(p);
    await db.$executeRawUnsafe("CREATE TRIGGER stay_abort BEFORE UPDATE OF currentPlanVersionId ON Trip BEGIN SELECT RAISE(ABORT, 'injected'); END");
    try { await expect(apply(p, proposal.previewToken)).rejects.toThrow(); } finally { await db.$executeRawUnsafe("DROP TRIGGER stay_abort"); }
    expect(await db.planVersion.count({ where: { tripId: p.tripId } })).toBe(1);
    await expect(service.previewAccommodation(p.tripId, p.versionNumber, "d1-hotel", values(p), AbortSignal.abort())).rejects.toThrow("取消");
  });
  it("rejects a hotel departure later than the early return redline without moving the ticket", async () => {
    let p = await fixture(2, true);
    for (const [id, startTime, endTime] of [["d2-breakfast", "05:00", "05:15"], ["d2-activity", "05:20", "05:30"], ["d2-lunch", "05:35", "05:45"], ["d2-rest", "05:45", "05:55"], ["return", "08:00", "09:30"]]) Object.assign(p.events.find((e) => e.id === id)!, { startTime, endTime, endDate: p.requestSnapshot.endDate, suggestedDurationSeconds: (Date.parse(`2000-01-01T${endTime}Z`) - Date.parse(`2000-01-01T${startTime}Z`)) / 1000 });
    await db.planVersion.update({ where: { id: p.id }, data: { events: JSON.stringify(p.events), validationResults: JSON.stringify(validatePlan(p, p.requestSnapshot, p.costs)) } });
    p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, action: { action: "activate", acknowledged: true, ticket: ticketFixture(p.requestSnapshot.endDate!, { eventId: "return", direction: "return", departureTime: "08:00", arrivalTime: "09:30", fromName: "返程站", fromDetail: null, chainOriginName: "测试酒店", accessMode: "walking" }) } });
    mockRoute(600); const proposal = await preview(p, { areaId: "return", kind: "hotel", hotelToken: token(p), morningDepartureTime: "07:50" });
    expect(proposal.canApply).toBe(false); expect(proposal.conflicts.join()).toContain("返程红线");
    expect((await plans.getPlanVersion(p.tripId, p.versionNumber)).tickets).toEqual(p.tickets);
  });
  it("changing a hotel invalidates its old manual return access instead of keeping an unsafe redline", async () => {
    let p = await fixture(2); p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, action: { action: "activate", acknowledged: true, ticket: ticketFixture(p.requestSnapshot.endDate!, { eventId: "return", direction: "return", departureTime: "17:00", arrivalTime: "18:30", chainOriginName: "住宿区域" }) } });
    const proposal = await preview(p), saved = await apply(p, proposal.previewToken);
    const line = ticketRedlineInput(saved, saved.tickets[0]); expect(line.route.durationSeconds).toBeNull(); expect(line.blockers.join()).toContain("住宿已改变");
    expect(saved.tickets).toEqual(p.tickets);
  });
});
