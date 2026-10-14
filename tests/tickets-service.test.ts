import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateBudgetSummary } from "../lib/budget";
import { validatePlan } from "../lib/plan";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";
import { ticketFixture } from "./helpers/ticket-fixtures";

let database: ReturnType<typeof isolatedDatabase>;
let db: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");
let routes: typeof import("../lib/route-service");

beforeAll(async () => {
  database = isolatedDatabase("unit-tickets");
  db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips");
  requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service");
  routes = await import("../lib/route-service");
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(async () => {
  await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), db?.$disconnect()]);
  database?.cleanup();
});

async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "隔离测试：门到门交通" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, draft.requestRevision);
  const plan = planFixture(capture.requestSnapshot);
  return plans.savePlanVersion({ capture, plan, validationResults: validatePlan(plan, capture.requestSnapshot) });
}

type Record = Awaited<ReturnType<typeof fixture>>;
const core = (current: Record, overrides: Parameters<typeof ticketFixture>[1] = {}) => ticketFixture(current.requestSnapshot.startDate!, overrides);
const act = (current: Record, action: Parameters<typeof plans.savePlanTicketEdit>[0]["action"]) =>
  plans.savePlanTicketEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, action });

async function pay(current: Record, costId: string, amount: number, paymentStatus: "paid" | "not_paid" = "paid") {
  return plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber,
    edit: { costId, unit: "per_ticket", unitAmountCents: amount, unitAmountMaxCents: null, quantity: 1, paymentStatus } });
}

describe("atomic ticket fact persistence", () => {
  it("saves drafts without changing routes, costs or constraints, then activates the same stable ID", async () => {
    const original = await fixture();
    const draft = await act(original, { action: "create_draft", ticket: core(original) });
    expect(draft.costs).toEqual(original.costs);
    expect(draft.events).toEqual(original.events);
    expect(draft.routeLegs).toEqual(original.routeLegs);
    expect(draft.validationResults).toEqual(original.validationResults);
    expect(draft.tickets[0]).toMatchObject({ status: "draft", confirmedAt: null });
    const active = await act(draft, { action: "activate_draft", ticketId: draft.tickets[0].id, acknowledged: true });
    expect(active.tickets[0]).toMatchObject({ id: draft.tickets[0].id, status: "active" });
    expect(active.tickets[0].confirmedAt).not.toBeNull();
    expect(active.events.find((event) => event.id === "departure")).toMatchObject({ locked: true, ticketManaged: true });
    expect((await plans.getPlanVersion(active.tripId, active.versionNumber)).tickets).toEqual(active.tickets);
    await expect(plans.savePlanEventEdit({ tripId: active.tripId, expectedPlanVersion: active.versionNumber,
      edit: { eventId: "departure", timeEdit: "preserve", note: null, locked: false, status: "confirmed", remove: false } }))
      .rejects.toThrow("当前有效票约束");
  });

  it("records incomplete flight facts and pending costs while keeping unknown fields null", async () => {
    const original = await fixture();
    const active = await act(original, { action: "activate", acknowledged: true,
      ticket: core(original, { mode: "flight", arrivalDate: null, arrivalTime: null, chainDestinationName: null,
        fareCents: null, accessFareCents: null, fromDetail: null, toDetail: null, boardingCutoffMinutes: null }) });
    expect(active.tickets[0]).toMatchObject({ status: "active", arrivalDate: null, arrivalTime: null, boardingCutoffMinutes: null });
    expect(active.validationResults.warnings.join(" ")).toContain("待补");
    expect(active.validationResults.warnings.join(" ")).toContain("航站楼待确认");
    expect(calculateBudgetSummary(active.costs, active.requestSnapshot).unknownItemCount).toBeGreaterThanOrEqual(2);
    expect(active.events.find((event) => event.id === "departure")?.ticketTimingPending).toBe(true);
  });

  it("completes missing active details with the same identity and confirmation, rejecting rewrites of known ticket fields", async () => {
    const original = await fixture();
    const incomplete = core(original, { arrivalDate: null, arrivalTime: null, fareCents: null, accessFareCents: null });
    const active = await act(original, { action: "activate", acknowledged: true, ticket: incomplete });
    const saved = await act(active, { action: "update_details", ticketId: active.tickets[0].id, acknowledged: true, ticket: core(active) });
    expect(saved.tickets).toHaveLength(1);
    expect(saved.tickets[0]).toMatchObject({ id: active.tickets[0].id, confirmedAt: active.tickets[0].confirmedAt,
      arrivalDate: original.requestSnapshot.startDate, arrivalTime: "07:30", fareCents: 10000 });
    expect(saved.costs.find((cost) => cost.id === `ticket-${saved.tickets[0].id}`)).toMatchObject({ unitAmountCents: 10000, certainty: "user_confirmed" });
    expect(saved.costs.find((cost) => cost.id.startsWith("ticket-transfer-") && cost.unitAmountCents === 2000)).toBeDefined();
    expect(saved.events.find((event) => event.id === "departure")?.ticketTimingPending).toBe(false);
    await expect(act(saved, { action: "update_details", ticketId: saved.tickets[0].id, acknowledged: true,
      ticket: core(saved, { departureTime: "06:45" }) })).rejects.toThrow("不能直接改写");
    expect((await plans.listPlanVersions(saved.tripId))[0].versionNumber).toBe(saved.versionNumber);
  });

  it("updates draft details without confirming them or changing the current plan budget", async () => {
    const original = await fixture();
    const draft = await act(original, { action: "create_draft", ticket: core(original) });
    const saved = await act(draft, { action: "update_details", ticketId: draft.tickets[0].id, acknowledged: true,
      ticket: core(draft, { serviceNumber: "MU1234", mode: "flight", fareCents: 30000 }) });
    expect(saved.tickets[0]).toMatchObject({ id: draft.tickets[0].id, status: "draft", confirmedAt: null, mode: "flight" });
    expect(saved.events).toEqual(original.events);
    expect(saved.costs).toEqual(original.costs);
    expect(saved.routeLegs).toEqual(original.routeLegs);
  });

  it("cancels only the selected shared ticket and preserves paid and separately confirmed refund facts", async () => {
    const original = await fixture();
    let current = await act(original, { action: "activate", acknowledged: true, ticket: core(original) });
    const first = current.tickets[0];
    const firstCost = `ticket-${first.id}`;
    current = await pay(current, firstCost, 10000);
    const accessCost = current.costs.find((cost) => cost.transferSide === "access")!;
    current = await pay(current, accessCost.id, 2000);
    current = await act(current, { action: "update_details", ticketId: first.id, acknowledged: true,
      ticket: core(current, { accessFareCents: 2500, accessNote: "新参考价，尚未确认补款" }) });
    expect(current.costs.find((cost) => cost.id === accessCost.id)).toMatchObject({ paymentStatus: "paid", unitAmountCents: 2000 });
    expect(current.costs.find((cost) => cost.id === accessCost.id)?.note).toContain("出发接驳全段参考 25 元");
    expect(current.costs.find((cost) => cost.id === accessCost.id)?.note).toContain("预算原记录 20 元");
    expect(current.costs.find((cost) => cost.id === accessCost.id)?.note).toContain("高 5 元");
    current = await act(current, { action: "activate", acknowledged: true, ticket: core(current) });
    const second = current.tickets[1];
    expect(current.costs.find((cost) => cost.id === accessCost.id)?.note).toContain("出发接驳全段参考 25 元");
    expect(current.costs.filter((cost) => cost.id.startsWith("ticket-transfer-"))).toHaveLength(2);
    current = await act(current, { action: "cancel", ticketId: first.id, acknowledged: true });
    expect(current.tickets.find((ticket) => ticket.id === first.id)).toMatchObject({ status: "cancelled", confirmedAt: first.confirmedAt });
    expect(current.tickets.find((ticket) => ticket.id === second.id)?.status).toBe("active");
    expect(current.events.find((event) => event.id === "departure")?.locked).toBe(true);
    expect(current.costs.find((cost) => cost.id === firstCost)).toMatchObject({ unitAmountCents: 10000, paymentStatus: "paid" });
    current = await pay(current, firstCost, 1200, "not_paid");
    current = await pay(current, accessCost.id, 600, "not_paid");
    current = await act(current, { action: "cancel", ticketId: second.id, acknowledged: true });
    expect(current.events.find((event) => event.id === "departure")).toMatchObject({ locked: false, status: "suggested", ticketManaged: false });
    expect(current.costs.find((cost) => cost.id === firstCost)).toMatchObject({ unitAmountCents: 1200, paymentStatus: "not_paid" });
    expect(current.costs.find((cost) => cost.id === accessCost.id)).toMatchObject({ unitAmountCents: 600, paymentStatus: "not_paid" });
    expect(current.tickets.every((ticket) => ticket.confirmedAt)).toBe(true);
    await expect(plans.getPlanGenerationContext(current.tripId, current.requestRevision)).rejects.toThrow("已保留当前计划");
  });

  it("explains first-ticket discrepancies while retaining the pre-existing paid cost and its stable identity", async () => {
    let current = await fixture();
    current = await pay(current, "cost-departure", 3000);
    const saved = await act(current, { action: "activate", acknowledged: true, ticket: core(current, { passengerCount: 2 }) });
    const preserved = saved.costs.find((cost) => cost.id === "cost-departure")!;
    expect(preserved).toMatchObject({ unitAmountCents: 3000, paymentStatus: "paid", unit: "per_ticket", quantity: 1 });
    expect(preserved.note).toContain("主票每人 100 元 × 2 人，合计 200 元");
    expect(preserved.note).toContain("预算原记录 30 元");
    expect(preserved.note).toContain("高 170 元");
    expect(preserved.note!.length).toBeLessThanOrEqual(240);
    expect(saved.costs.some((cost) => cost.id === `ticket-${saved.tickets[0].id}`)).toBe(false);
  });

  it("replaces only the designated ticket atomically, keeps another active service as a visible conflict and allows payment edits", async () => {
    const original = await fixture();
    let current = await act(original, { action: "activate", acknowledged: true, ticket: core(original) });
    const first = current.tickets[0];
    current = await pay(current, `ticket-${first.id}`, 10000);
    current = await act(current, { action: "activate", acknowledged: true, ticket: core(current) });
    const second = current.tickets[1];
    current = await act(current, { action: "replace", ticketId: first.id, acknowledged: true,
      replacement: core(current, { serviceNumber: "G456", departureTime: "10:00", arrivalTime: "11:00", fromDetail: "另一进站口" }) });
    const historical = current.tickets.find((ticket) => ticket.id === first.id)!;
    const replacement = current.tickets.find((ticket) => ticket.id === historical.replacedByTicketId)!;
    expect(historical).toMatchObject({ status: "replaced", confirmedAt: first.confirmedAt });
    expect(replacement.status).toBe("active");
    expect(current.tickets.find((ticket) => ticket.id === second.id)?.status).toBe("active");
    expect(current.validationResults.warnings.join(" ")).toContain("单线行程无法同时表达");
    expect(current.costs.find((cost) => cost.id === `ticket-${first.id}`)).toMatchObject({ unitAmountCents: 10000, paymentStatus: "paid" });
    current = await act(current, { action: "cancel", ticketId: second.id, acknowledged: true });
    expect(current.validationResults.errors.length).toBeGreaterThan(0);
    const paid = await pay(current, `ticket-${replacement.id}`, 11000);
    expect(paid.validationResults.errors).toEqual(current.validationResults.errors);
    expect(paid.costs.find((cost) => cost.id === `ticket-${replacement.id}`)?.paymentStatus).toBe("paid");
  });

  it("keeps the plan request snapshot and revision after unconfirmed requirement changes", async () => {
    const original = await fixture();
    await requests.saveRequestDraft(original.tripId, { expectedRequestRevision: original.requestRevision,
      request: { ...original.requestSnapshot, budgetAmountCents: 999999 } });
    const saved = await act(original, { action: "activate", acknowledged: true, ticket: core(original) });
    expect(saved).toMatchObject({ requirementUpToDate: false, requestRevision: original.requestRevision, requestSnapshot: original.requestSnapshot });
    expect((await trips.getTrip(original.tripId))?.status).toBe("plan_needs_update");
    const cancelled = await act(saved, { action: "cancel", acknowledged: true, ticketId: saved.tickets[0].id });
    expect(cancelled).toMatchObject({ requirementUpToDate: false, requestRevision: original.requestRevision, requestSnapshot: original.requestSnapshot });
    expect((await plans.getPlanVersion(original.tripId, original.versionNumber)).tickets).toEqual([]);
  });

  it("invalidates old route times and geometry while saving real facts even when route services are offline", async () => {
    let current = await fixture();
    for (const [eventId, poiId] of [["d1-preparation", "1"], ["departure", "2"]]) {
      current = await plans.savePlanPlaceEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber, eventId, precision: "poi",
        candidate: { provider: "osm", poiId, name: eventId === "departure" ? "测试出发站" : "公共地标", city: "长沙", district: "", address: "", adcode: "", category: "", coordinateSystem: "WGS84", longitude: 112.97, latitude: 28.19, retrievedAt: new Date().toISOString() } });
    }
    current = await routes.saveManualPlanRoute(current.tripId, current.versionNumber, {
      fromEventId: "d1-preparation", toEventId: "departure", departureTime: "06:15",
      manualReference: { availability: "available", instructions: "测试接驳：公共地标到测试站", durationMinutes: 5, fareCents: 2000,
        sourceName: "隔离人工记录", sourceUrl: null, checkedAt: new Date().toISOString(), acknowledged: true },
    });
    const old = current;
    const fetchMock = vi.fn(() => { throw new Error("route service offline"); });
    vi.stubGlobal("fetch", fetchMock);
    const active = await act(current, { action: "activate", acknowledged: true, ticket: core(current) });
    expect(active.tickets[0].status).toBe("active");
    expect(active.routeLegs[0]).toMatchObject({ durationSeconds: null, arrivalTime: null, polyline: [], status: "pending_confirmation", manualReference: { requiresReconfirmation: true } });
    const cancelled = await act(active, { action: "cancel", acknowledged: true, ticketId: active.tickets[0].id });
    expect(cancelled.tickets[0].status).toBe("cancelled");
    expect(cancelled.routeLegs.every((route) => route.arrivalTime === null && route.polyline.length === 0)).toBe(true);
    expect((await plans.getPlanVersion(old.tripId, old.versionNumber)).routeLegs).toEqual(old.routeLegs);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rolls back new version, ticket status and costs when the final trip update fails", async () => {
    const original = await fixture();
    const active = await act(original, { action: "activate", acknowledged: true, ticket: core(original) });
    await db.$executeRawUnsafe("CREATE TRIGGER ticket_test_fail BEFORE UPDATE ON Trip BEGIN SELECT RAISE(ABORT, 'synthetic commit failure'); END");
    try {
      await expect(act(active, { action: "replace", ticketId: active.tickets[0].id, acknowledged: true,
        replacement: core(active, { serviceNumber: "G999" }) })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe("DROP TRIGGER ticket_test_fail");
    }
    const latest = (await plans.listPlanVersions(active.tripId))[0];
    expect(latest.versionNumber).toBe(active.versionNumber);
    expect(latest.tickets).toEqual(active.tickets);
    expect(latest.costs).toEqual(active.costs);
    expect(latest.isCurrent).toBe(true);
  });

  it("permits only one concurrent submission and rejects a stale version without partial changes", async () => {
    const current = await fixture();
    const results = await Promise.allSettled([
      act(current, { action: "activate", acknowledged: true, ticket: core(current) }),
      act(current, { action: "activate", acknowledged: true, ticket: core(current, { serviceNumber: "G222" }) }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const latest = (await plans.listPlanVersions(current.tripId))[0];
    expect(latest.versionNumber).toBe(current.versionNumber + 1);
    expect(latest.tickets).toHaveLength(1);
    await expect(act(current, { action: "activate", acknowledged: true, ticket: core(current) })).rejects.toThrow("计划已变化");
    expect((await plans.listPlanVersions(current.tripId))[0].tickets).toEqual(latest.tickets);
  });
});
