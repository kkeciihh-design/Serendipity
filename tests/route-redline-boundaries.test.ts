import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { derivePlanCosts, type PlanCostItem } from "../lib/budget";
import { applyPlanEventEdit } from "../lib/plan-edit";
import { preparePlanForStorage, validatePlan, type PlanEvent } from "../lib/plan";
import type { PlanVersionRecord } from "../lib/plan-service";
import { buildPlanRedlines, ticketRedlineInput } from "../lib/redline-service";
import { manualReferenceRoute, parseAmapRoute } from "../lib/routes";
import { activateTicket, applyTicketsToEvents } from "../lib/tickets";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { isolatedDatabase } from "./helpers/test-database";

function redlinePlan(): PlanVersionRecord {
  const snapshot = requestFixture(2, { startDate: "2026-10-20", endDate: "2026-10-21" });
  const ticket = activateTicket(ticketFixture(snapshot.startDate!, {
    departureTime: "10:35", arrivalTime: "11:35", accessMode: "walking", accessDurationMinutes: 55,
    bufferMinutes: 10, chainOriginName: "家门口",
  }));
  const content = planFixture(snapshot);
  content.events = content.events.map((event) => event.id === "d1-breakfast" ? { ...event, startTime: "07:00", endTime: "07:30" }
    : event.id === "d1-activity" ? { ...event, startTime: "14:30", endTime: "16:30" }
      : event.id === "d1-preparation" ? { ...event, startTime: "08:00", endTime: "08:30", locationName: "家门口" } : event);
  const normalized = preparePlanForStorage({ ...content, events: applyTicketsToEvents(content.events, [ticket]) });
  return { ...normalized, id: "redline-input-test", tripId: "redline-input-test", versionNumber: 1, requestRevision: 1,
    requestSnapshot: snapshot, tickets: [ticket], places: [], routeLegs: [], costs: derivePlanCosts(normalized.events),
    isCurrent: true, requirementUpToDate: true, validationResults: validatePlan(normalized, snapshot),
    createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" };
}

function moveEvent(plan: PlanVersionRecord, eventId: string, startTime: string, durationMinutes: number) {
  return { ...plan, ...preparePlanForStorage(applyPlanEventEdit(plan, {
    eventId, startTime, durationMinutes, timeEdit: "start_duration", note: null, locked: false, status: "suggested", remove: false,
  })) };
}

describe("redline input occupancy", () => {
  it.each(["preparation", "local_transport"] as const)("keeps independent %s occupancy in a complete edited plan", async (type) => {
    let plan = redlinePlan();
    if (type === "local_transport") {
      plan.events.push({ ...plan.events.find((event) => event.id === "d1-preparation")!, id: "independent-transit", type,
        title: "独立市内交通", locationName: "药店" });
      plan = moveEvent(plan, "d1-preparation", "06:00", 15);
    }
    plan = moveEvent(plan, type === "preparation" ? "d1-preparation" : "independent-transit", "08:00", 70);
    expect(validatePlan(plan, plan.requestSnapshot).errors).toEqual([]);
    const result = (await buildPlanRedlines(plan, "2026-10-20T00:00:00.000Z"))[0];
    expect(result.suggestedAt).toBe("2026-10-20T00:55:00.000Z");
    expect(result.input.earliestDepartureAt).toBe("2026-10-20T01:10:00.000Z");
    expect(result.precision).toBe("pending_confirmation");
    expect(result.conflicts.join()).toContain("晚于建议出发");
  });

  it("excludes only explicit transport intervals already included in the applicable access route", () => {
    const plan = redlinePlan();
    plan.events.push({ ...plan.events.find((event) => event.id === "d1-preparation")!, id: "access-transit", type: "local_transport",
      startTime: "08:55", endTime: "09:50" });
    const route = manualReferenceRoute({ tripId: plan.tripId, date: plan.requestSnapshot.startDate!, edit: {
      fromEventId: "d1-preparation", toEventId: "departure", departureTime: "08:55", manualReference: {
        availability: "available", instructions: "全段接驳含步行及乘车", durationMinutes: 55, fareCents: null,
        sourceName: "合成参考", sourceUrl: null, checkedAt: "2026-10-15T00:00:00.000Z", acknowledged: true,
      },
    } });
    plan.routeLegs = [{ ...route, transportEventIds: ["access-transit"] }];
    expect(ticketRedlineInput(plan, plan.tickets[0]).earliestDepartureAt).toBe("2026-10-20T00:30:00.000Z");
    plan.routeLegs[0].includedTimes = [];
    expect(ticketRedlineInput(plan, plan.tickets[0]).earliestDepartureAt).toBe("2026-10-20T01:50:00.000Z");
    plan.routeLegs[0].includedTimes = route.includedTimes;
    plan.routeLegs[0].transportEventIds = [];
    expect(ticketRedlineInput(plan, plan.tickets[0]).earliestDepartureAt).toBe("2026-10-20T01:50:00.000Z");
    plan.routeLegs[0].transportEventIds = ["access-transit"];
    plan.events.find((event) => event.id === "access-transit")!.endTime = "10:00";
    expect(ticketRedlineInput(plan, plan.tickets[0]).earliestDepartureAt).toBe("2026-10-20T02:00:00.000Z");
    plan.routeLegs[0].durationSeconds = null;
    expect(ticketRedlineInput(plan, plan.tickets[0]).earliestDepartureAt).toBe("2026-10-20T02:00:00.000Z");
  });

  it("takes the latest occupied end even from an earlier long or cross-midnight event", async () => {
    const plan = redlinePlan();
    plan.events.push({ ...plan.events[0], id: "overnight", type: "preparation", date: "2026-10-19", startTime: "23:00",
      endDate: "2026-10-20", endTime: "09:10" });
    expect(ticketRedlineInput(plan, plan.tickets[0]).earliestDepartureAt).toBe("2026-10-20T01:10:00.000Z");
    const exact = moveEvent(redlinePlan(), "d1-preparation", "08:00", 55);
    expect((await buildPlanRedlines(exact, "2026-10-20T00:00:00.000Z"))[0].conflicts).toEqual([]);
  });

  it("never reuses a legacy outgoing main-transport route as a new ticket access route", () => {
    const plan = redlinePlan();
    const prior: PlanEvent = { ...plan.events[0], id: "old-main", type: "departure_transport", locationName: "家门口",
      startTime: "06:00", endTime: "07:00" };
    plan.events.push(prior);
    const route = manualReferenceRoute({ tripId: plan.tripId, date: plan.requestSnapshot.startDate!, edit: {
      fromEventId: prior.id, toEventId: "departure", departureTime: "08:55", manualReference: {
        availability: "available", instructions: "旧错站路线", durationMinutes: 1, fareCents: 600,
        sourceName: "历史合成参考", sourceUrl: null, checkedAt: "2026-10-15T00:00:00.000Z", acknowledged: true,
      },
    } });
    plan.routeLegs = [route];
    const input = ticketRedlineInput(plan, plan.tickets[0]);
    expect(input.route.durationSeconds).toBe(55 * 60);
    expect(input.assumptions.join()).toContain("不能代用");
  });
});

describe("provider partial and unknown prices", () => {
  const transitPayload = (cost: unknown) => ({ status: "1", route: { transits: [{ duration: "1800", walking_distance: "100", cost,
    segments: [{ walking: { steps: [{ instruction: "步行", duration: "100", distance: "100" }] } }] }] } });
  it.each([undefined, null, "", " ", [], {}, false, "no-price", -1, Infinity])("keeps absent or invalid provider fare %j unknown", (cost) => {
    const result = parseAmapRoute(transitPayload(cost), "public_transit");
    expect(result.available).toBe(true);
    expect(result.cost).toMatchObject({ minCents: null, maxCents: null });
  });
  it.each([[0, 0], ["0", 0], ["6.5", 650], [6.5, 650]])("accepts explicit provider fare %s", (value, cents) => {
    expect(parseAmapRoute(transitPayload(value), "public_transit").cost).toMatchObject({ minCents: cents, maxCents: cents });
  });
  it("keeps the whole driving fare unknown when only tolls are returned", () => {
    const result = parseAmapRoute({ status: "1", route: { paths: [{ distance: "8000", duration: "900", tolls: "10",
      steps: [{ instruction: "道路", distance: "8000", duration: "900", polyline: "113.1,22.1;113.2,22.2" }] }] } }, "driving");
    expect(result.available).toBe(true);
    expect(result.cost).toMatchObject({ minCents: null, maxCents: null });
    expect(result.cost.basis).toContain("通行费 10 元");
  });
  it.each([undefined, null, "", [], "invalid", 0])("does not offer a road with unknown or zero duration %j", (duration) => {
    const result = parseAmapRoute({ status: "1", route: { paths: [{ distance: null, duration, steps: [
      { instruction: "道路", polyline: "113.1,22.1;113.2,22.2" },
    ] }] } }, "driving");
    expect(result.available).toBe(false);
    expect(result.distanceMeters).toBeNull();
  });
  it("keeps an unknown distance unknown even when the road duration is usable", () => {
    const result = parseAmapRoute({ status: "1", route: { paths: [{ distance: null, duration: "900", steps: [
      { instruction: "道路", polyline: "113.1,22.1;113.2,22.2" },
    ] }] } }, "walking");
    expect(result.available).toBe(true);
    expect(result.distanceMeters).toBeNull();
  });
});

describe("city route origin service and legacy snapshots", () => {
  let database: ReturnType<typeof isolatedDatabase>;
  let db: PrismaClient;
  let trips: typeof import("../lib/trips");
  let requests: typeof import("../lib/trip-request-service");
  let plans: typeof import("../lib/plan-service");
  let routes: typeof import("../lib/route-service");
  beforeAll(async () => {
    database = isolatedDatabase("unit-route-boundaries");
    db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
    trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service");
    plans = await import("../lib/plan-service"); routes = await import("../lib/route-service");
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  afterAll(async () => {
    await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), db?.$disconnect()]);
    database?.cleanup();
  });

  async function fixture() {
    const trip = await trips.createTrip({ originalRequest: "合成测试：跨城到站后的接驳" });
    const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
    await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
    const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision);
    const content = planFixture(capture.requestSnapshot);
    let current = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
    for (const [eventId, name] of [["departure", "深圳北站"], ["d1-activity", "长沙博物馆"]]) {
      current = await plans.savePlanPlaceEdit({ tripId: trip.id, expectedPlanVersion: current.versionNumber, eventId, precision: "poi",
        candidate: { provider: "osm", poiId: eventId.replaceAll("-", ""), name, city: eventId === "departure" ? "深圳" : "长沙", district: "", address: "", adcode: "", category: "",
          coordinateSystem: "WGS84", longitude: 113, latitude: 23, retrievedAt: new Date().toISOString() } });
    }
    return plans.savePlanTicketEdit({ tripId: trip.id, expectedPlanVersion: current.versionNumber,
      action: { action: "activate", acknowledged: true, ticket: ticketFixture(current.requestSnapshot.startDate!, { fromName: "深圳北站", egressMode: null }) } });
  }
  function manual(current: PlanVersionRecord) {
    return { fromEventId: "departure", toEventId: "d1-activity", departureTime: "07:30", manualReference: {
      availability: "available" as const, instructions: "到站后人工接驳", durationMinutes: 20, fareCents: 600,
      sourceName: "合成参考", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true as const,
    }, date: current.requestSnapshot.startDate! };
  }
  it("rejects wrong-station automatic, manual and direct transactional route saves without fetching or writing", async () => {
    const current = await fixture();
    const fetchMock = vi.fn(() => { throw new Error("No external request allowed"); }); vi.stubGlobal("fetch", fetchMock);
    const input = manual(current);
    await expect(routes.searchAndSavePlanRoute(current.tripId, current.versionNumber, { ...input, mode: "walking" })).rejects.toThrow("出发站");
    await expect(routes.saveManualPlanRoute(current.tripId, current.versionNumber, input)).rejects.toThrow("出发站");
    const route = manualReferenceRoute({ tripId: current.tripId, date: input.date, edit: input });
    await expect(plans.savePlanRouteEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, route })).rejects.toThrow("出发站");
    expect((await plans.listPlanVersions(current.tripId))[0].versionNumber).toBe(current.versionNumber);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  async function legacy(current: PlanVersionRecord, protect?: Partial<PlanCostItem>) {
    const input = manual(current);
    const route = { ...manualReferenceRoute({ tripId: current.tripId, date: input.date, edit: input }),
      polyline: [{ longitude: 113, latitude: 23 }, { longitude: 114, latitude: 24 }] };
    const costs = plans.applyRouteCost(route, current.events, current.costs).map((cost) => cost.id.startsWith("route-") ? { ...cost, ...protect } : cost);
    await db.planVersion.update({ where: { id: current.id }, data: { routeLegs: JSON.stringify([route]), costs: JSON.stringify(costs) } });
    return { route, costs, raw: await db.planVersion.findUniqueOrThrow({ where: { id: current.id } }) };
  }
  it("downgrades current legacy estimates in every read without writing, then preserves old historical money on a new save", async () => {
    const current = await fixture();
    const original = await legacy(current);
    const read = await plans.getPlanVersion(current.tripId, current.versionNumber);
    expect(read.routeLegs[0]).toMatchObject({ durationSeconds: null, arrivalTime: null, polyline: [] });
    expect(read.costs.find((cost) => cost.id.startsWith("route-"))).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    expect(read.validationResults.warnings.join()).toContain("原路线起点不适用");
    expect(await db.planVersion.findUniqueOrThrow({ where: { id: current.id } })).toEqual(original.raw);
    const saved = await plans.savePlanEventEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber,
      edit: { eventId: "d1-breakfast", timeEdit: "preserve", note: "核对早餐", status: "suggested", locked: false, remove: false } });
    const savedRaw = await db.planVersion.findUniqueOrThrow({ where: { id: saved.id } });
    expect((JSON.parse(savedRaw.costs) as PlanCostItem[]).find((cost) => cost.id.startsWith("route-"))?.unitAmountCents).toBeNull();
    const history = await plans.getPlanVersion(current.tripId, current.versionNumber);
    expect(history.costs).toEqual(original.costs);
    expect(history.routeLegs[0].polyline).toEqual([]);
    expect(history.validationResults.warnings.join()).toContain("历史路线起点不适用");
    expect(await db.planVersion.findUniqueOrThrow({ where: { id: current.id } })).toEqual(original.raw);
  });
  it.each([
    { certainty: "user_confirmed" as const, source: "user_confirmed" as const },
    { paymentStatus: "paid" as const }, { paymentStatus: "refund_pending" as const },
  ])("preserves confirmed, paid and refund monetary facts while invalidating the wrong origin: %j", async (protect) => {
    const current = await fixture();
    const original = await legacy(current, protect);
    const read = await plans.getPlanVersion(current.tripId, current.versionNumber);
    expect(read.costs).toEqual(original.costs);
    expect(read.routeLegs[0].arrivalTime).toBeNull();
  });
});
