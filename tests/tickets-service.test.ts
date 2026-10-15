import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { calculateBudgetSummary } from "../lib/budget";
import { validatePlan } from "../lib/plan";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { isolatedDatabase } from "./helpers/test-database";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { defaultRedlinePreferences } from "../lib/redline-preferences";
import { buildPlanRedlines, ticketRedlineInput } from "../lib/redline-service";
import { manualReferenceRoute, readCachedRoute } from "../lib/routes";
import { parseTicketRecognition } from "../lib/ticket-ocr";
import type { TicketImportSource } from "../lib/ticket-import";

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
  const importSource: TicketImportSource = { engine: "tesseract-local", imageFingerprint: "a".repeat(64), cropFingerprint: "b".repeat(64), recognizedAt: "2026-10-15T08:00:00.000Z", documentKind: "ticket" };

  it("rechecks stored OCR draft identity against the final plan and requires a fresh companion decision", async () => {
    let current = await fixture();
    const ticket = core(current, { seat: "05车08A", fareCents: 24300, accessMode: null, egressMode: null });
    current = await act(current, { action: "create_draft", ticket, importSource, importResolution: "new" });
    const draftId = current.tickets[0].id;
    current = await act(current, { action: "activate", ticket, acknowledged: true });
    await expect(act(current, { action: "activate_draft", ticketId: draftId, acknowledged: true })).rejects.toThrow("疑似重复");
    expect((await plans.getPlanVersion(current.tripId, current.versionNumber)).costs).toEqual(current.costs);
    expect((await plans.listPlanVersions(current.tripId))[0].versionNumber).toBe(current.versionNumber);
    current = await act(current, { action: "update_details", ticketId: draftId, ticket: { ...ticket, seat: "05车08B" }, acknowledged: true });
    await expect(act(current, { action: "activate_draft", ticketId: draftId, acknowledged: true })).rejects.toThrow("疑似重复");
    const activated = await act(current, { action: "activate_draft", ticketId: draftId, importResolution: "companion", acknowledged: true });
    expect(activated.tickets.filter((t) => t.status === "active")).toHaveLength(2);
    expect(activated.tickets.find((t) => t.id === draftId)).toMatchObject({ seat: "05车08B", importSource });
    expect(activated.costs.filter((cost) => cost.id.startsWith("ticket-")).reduce((sum, cost) => sum + (cost.unitAmountCents ?? 0), 0)).toBe(48600);
  });

  it("does not consider an OCR draft a duplicate of itself", async () => {
    let current = await fixture();
    current = await act(current, { action: "create_draft", ticket: core(current), importSource, importResolution: "new" });
    const active = await act(current, { action: "activate_draft", ticketId: current.tickets[0].id, acknowledged: true });
    expect(active.tickets[0].status).toBe("active");
  });

  it("keeps the OCR category while honoring explicit user correction and preserving refund/change confirmation gates", async () => {
    const current = await fixture();
    const source = { ...importSource, documentKind: "refund" as const };
    await expect(act(current, { action: "activate", ticket: core(current), acknowledged: true, importSource: source })).rejects.toThrow("退票资料");
    const saved = await act(current, { action: "activate", ticket: core(current), acknowledged: true,
      importSource: { ...source, confirmedDocumentKind: "ticket" }, importResolution: "new" });
    expect(saved.tickets[0].importSource).toMatchObject({ documentKind: "refund", confirmedDocumentKind: "ticket" });
    await expect(act(saved, { action: "activate", ticket: core(saved), acknowledged: true,
      importSource: { ...importSource, confirmedDocumentKind: "change" }, importResolution: "companion" })).rejects.toThrow("改签资料");
  });

  it.each(["per_ticket", "per_person", "one_time"] as const)("requires explicit attribution for an existing paid group fare (%s)", async (unit) => {
    let current = await fixture();
    current = await plans.savePlanCostEdit({ tripId: current.tripId, expectedPlanVersion: current.versionNumber,
      edit: { costId: "cost-departure", unit, unitAmountCents: unit === "one_time" ? 48600 : 24300,
        unitAmountMaxCents: null, quantity: unit === "per_ticket" ? 2 : null, paymentStatus: "paid" } });
    const original = current;
    const ticket = core(current, { seat: "05车08A", fareCents: null, accessMode: null, egressMode: null });
    current = await act(current, { action: "create_draft", ticket, importSource, importResolution: "new" });
    const firstId = current.tickets[0].id;
    current = await act(current, { action: "activate_draft", ticketId: firstId, acknowledged: true });
    expect(current.tickets[0].costAllocation).toEqual({ kind: "pending" });
    current = await act(current, { action: "update_details", ticketId: firstId, ticket: { ...ticket, fareCents: 24300 }, acknowledged: true });
    expect(current.costs.find((cost) => cost.id === `ticket-${firstId}`)?.unitAmountCents).toBeNull();
    const beforeBinding = current;
    current = await act(current, { action: "resolve_cost", ticketId: firstId, costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true });
    expect(current.events).toEqual(beforeBinding.events); expect(current.routeLegs).toEqual(beforeBinding.routeLegs);
    expect(current.tickets[0].confirmedAt).toBe(beforeBinding.tickets[0].confirmedAt);
    current = await act(current, { action: "activate", ticket: { ...ticket, seat: "05车08B", fareCents: 24300 }, importSource, importResolution: "companion",
      costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true });
    const ticketCosts = current.costs.filter((cost) => cost.linkedEventId === "departure");
    expect(ticketCosts).toHaveLength(1);
    expect(ticketCosts[0]).toMatchObject({ id: "cost-departure", paymentStatus: "paid", unit: original.costs.find((cost) => cost.id === "cost-departure")!.unit,
      unitAmountCents: original.costs.find((cost) => cost.id === "cost-departure")!.unitAmountCents });
    expect(calculateBudgetSummary(current.costs, current.requestSnapshot).totalMinCents).toBe(calculateBudgetSummary(original.costs, original.requestSnapshot).totalMinCents);
    const second = current.tickets[1];
    current = await act(current, { action: "cancel", ticketId: firstId, acknowledged: true });
    expect(current.tickets[1]).toEqual(second);
    expect(current.costs.filter((cost) => cost.linkedEventId === "departure")).toEqual(ticketCosts);
    const replaced = await act(current, { action: "replace", ticketId: second.id, replacement: { ...ticket, serviceNumber: "G789", fareCents: 30000 }, acknowledged: true });
    const newTicket = replaced.tickets.find((t) => t.status === "active")!;
    expect(newTicket.costAllocation).toEqual({ kind: "pending" });
    expect(replaced.costs.find((cost) => cost.id === `ticket-${newTicket.id}`)?.unitAmountCents).toBeNull();
    expect((await plans.getPlanVersion(original.tripId, original.versionNumber)).costs).toEqual(original.costs);
  });

  it("rejects invalid cost attribution, keeps payments, and allows only one version of a pending decision", async () => {
    let current = await fixture();
    current = await pay(current, "cost-departure", 48600);
    current = await act(current, { action: "activate", ticket: core(current, { accessMode: null, egressMode: null }), acknowledged: true });
    const ticketId = current.tickets[0].id;
    for (const costId of ["cost-return", "another-trip-cost", `ticket-${ticketId}`]) {
      await expect(act(current, { action: "resolve_cost", ticketId, costAllocation: { kind: "existing", costId }, acknowledged: true })).rejects.toThrow("只能关联");
    }
    const results = await Promise.allSettled([0, 1].map(() => act(current, { action: "resolve_cost", ticketId,
      costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const latest = (await plans.listPlanVersions(current.tripId))[0];
    expect(latest.costs.find((cost) => cost.id === "cost-departure")).toMatchObject({ unitAmountCents: 48600, paymentStatus: "paid" });
    await expect(act(current, { action: "resolve_cost", ticketId, costAllocation: { kind: "separate" }, acknowledged: true })).rejects.toThrow();
    let separate = await fixture();
    separate = await act(separate, { action: "activate", ticket: core(separate), acknowledged: true });
    separate = await pay(separate, `ticket-${separate.tickets[0].id}`, 10000);
    await expect(act(separate, { action: "resolve_cost", ticketId: separate.tickets[0].id, costAllocation: { kind: "pending" }, acknowledged: true })).rejects.toThrow("已确认费用");
  });

  it("preserves legacy implicit first-ticket payments without adding a price until explicit attribution", async () => {
    let current = await fixture();
    current = await pay(current, "cost-departure", 48600);
    current = await act(current, { action: "activate", ticket: core(current, { accessMode: null, egressMode: null }),
      costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true });
    const legacyTickets = current.tickets.map(({ costAllocation, ...ticket }) => { void costAllocation; return ticket; });
    await db.planVersion.update({ where: { id: current.id }, data: { tickets: JSON.stringify(legacyTickets) } });
    const legacy = await plans.getPlanVersion(current.tripId, current.versionNumber);
    current = await act(legacy, { action: "update_details", ticketId: legacy.tickets[0].id,
      ticket: core(legacy, { accessMode: null, egressMode: null, note: "补充已知行李资料" }), acknowledged: true });
    expect(current.costs.filter((cost) => cost.linkedEventId === "departure")).toHaveLength(1);
    expect(current.costs.find((cost) => cost.id === "cost-departure")).toMatchObject({ unitAmountCents: 48600, paymentStatus: "paid" });
    expect(current.tickets[0].costAllocation).toBeUndefined();
    const bound = await act(current, { action: "resolve_cost", ticketId: current.tickets[0].id,
      costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true });
    expect(bound.tickets[0].costAllocation).toEqual({ kind: "existing", costId: "cost-departure" });
    expect((await plans.getPlanVersion(legacy.tripId, legacy.versionNumber)).tickets).toEqual(legacy.tickets);
  });

  it("rolls back cost attribution and preserves paid group refunds on later ticket changes", async () => {
    let current = await fixture();
    current = await pay(current, "cost-departure", 48600);
    current = await act(current, { action: "activate", ticket: core(current, { accessMode: null, egressMode: null }), acknowledged: true });
    const ticketId = current.tickets[0].id;
    await db.$executeRawUnsafe("CREATE TRIGGER ticket_binding_fail BEFORE UPDATE ON Trip BEGIN SELECT RAISE(ABORT, 'synthetic binding failure'); END");
    try {
      await expect(act(current, { action: "resolve_cost", ticketId, costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true })).rejects.toThrow();
    } finally { await db.$executeRawUnsafe("DROP TRIGGER ticket_binding_fail"); }
    const unchanged = (await plans.listPlanVersions(current.tripId))[0];
    expect(unchanged.versionNumber).toBe(current.versionNumber); expect(unchanged.costs).toEqual(current.costs); expect(unchanged.tickets).toEqual(current.tickets);
    current = await act(current, { action: "resolve_cost", ticketId, costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true });
    current = await pay(current, "cost-departure", 1200, "not_paid");
    current = await act(current, { action: "cancel", ticketId, acknowledged: true });
    expect(current.costs.find((cost) => cost.id === "cost-departure")).toMatchObject({ unitAmountCents: 1200, paymentStatus: "not_paid" });
  });

  it("can confirm a pending ticket as separately paid without erasing that payment or treating an unknown fare as zero", async () => {
    let current = await fixture();
    current = await pay(current, "cost-departure", 48600);
    current = await act(current, { action: "activate", ticket: core(current, { fareCents: null, accessMode: null, egressMode: null }), acknowledged: true });
    const ticketId = current.tickets[0].id;
    const separate = await act(current, { action: "resolve_cost", ticketId, costAllocation: { kind: "separate" }, acknowledged: true });
    expect(separate.costs.find((cost) => cost.id === `ticket-${ticketId}`)).toMatchObject({ unitAmountCents: null, certainty: "pending_confirmation" });
    expect(separate.costs.find((cost) => cost.id === `ticket-${ticketId}`)?.note).not.toContain("归属待核对");
    current = await pay(separate, `ticket-${ticketId}`, 24300);
    const saved = await act(current, { action: "resolve_cost", ticketId, costAllocation: { kind: "separate" }, acknowledged: true });
    expect(saved.costs.find((cost) => cost.id === `ticket-${ticketId}`)).toMatchObject({ unitAmountCents: 24300, paymentStatus: "paid" });
    await expect(act(saved, { action: "resolve_cost", ticketId, costAllocation: { kind: "existing", costId: "cost-departure" }, acknowledged: true })).rejects.toThrow("已确认费用");
  });
  it("T30 imported tickets share manual redlines, preserve companions/payments and invalidate only active constraints", async () => {
    const original = await fixture();
    const date = original.requestSnapshot.startDate!;
    const source: TicketImportSource = { engine: "tesseract-local", imageFingerprint: "a".repeat(64), cropFingerprint: "b".repeat(64), recognizedAt: new Date().toISOString(), documentKind: "ticket" };
    const fields = parseTicketRecognition(`深圳北 G6012 长沙南\n${date} 06:30\n${date} 07:30\n05车08A\n票价:243.00`).segments[0].fields;
    const ticket = core(original, fields);
    let current = await act(original, { action: "activate", ticket, acknowledged: true, importSource: source, importResolution: "new" });
    const first = current.tickets[0];
    expect(first.importSource).toEqual(source);
    const reference = await fixture();
    const manual = await act(reference, { action: "activate", ticket, acknowledged: true });
    expect((await buildPlanRedlines(current))[0].suggestedAt).toBe((await buildPlanRedlines(manual))[0].suggestedAt);
    current = await pay(current, `ticket-${first.id}`, 24300);
    await expect(act(current, { action: "activate", ticket, acknowledged: true, importSource: source, importResolution: "new" })).rejects.toThrow("疑似重复");
    expect((await plans.listPlanVersions(current.tripId))[0].tickets).toHaveLength(1);
    current = await act(current, { action: "activate", ticket: { ...ticket, seat: "05车08B", fareCents: null }, acknowledged: true, importSource: source, importResolution: "companion" });
    const companion = current.tickets[1];
    expect(current.costs.find((cost) => cost.id === `ticket-${companion.id}`)?.unitAmountCents).toBeNull();
    const before = (await buildPlanRedlines(current))[0].calculationVersion;
    await requests.saveRequestDraft(current.tripId, { expectedRequestRevision: current.requestRevision, request: { ...current.requestSnapshot, budgetAmountCents: 999999 } });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    current = await act(current, { action: "replace", ticketId: first.id, replacement: { ...ticket, serviceNumber: "G888", departureTime: "09:30", arrivalTime: null }, acknowledged: true, importSource: { ...source, documentKind: "change" }, importResolution: "replacement" });
    expect(current).toMatchObject({ requirementUpToDate: false, requestSnapshot: original.requestSnapshot, requestRevision: original.requestRevision });
    expect(current.tickets.find((t) => t.id === companion.id)).toEqual(companion);
    const old = current.tickets.find((t) => t.id === first.id)!;
    expect(old.status).toBe("replaced"); expect(old.confirmedAt).toBe(first.confirmedAt);
    const replacement = current.tickets.find((t) => t.id === old.replacedByTicketId)!;
    expect(replacement.status).toBe("active");
    const redlines = await buildPlanRedlines(current);
    expect(redlines.every((r) => r.calculationVersion !== before)).toBe(true);
    expect(redlines.every((r) => r.precision === "pending_confirmation")).toBe(true);
    expect(current.events.find((e) => e.id === "departure")?.ticketTimingPending).toBe(true);
    expect(current.costs.find((cost) => cost.id === `ticket-${first.id}`)).toMatchObject({ paymentStatus: "paid", unitAmountCents: 24300 });
    current = await act(current, { action: "cancel", ticketId: replacement.id, acknowledged: true });
    expect(current.tickets.find((t) => t.id === companion.id)).toEqual(companion);
    expect((await buildPlanRedlines(current))).toHaveLength(1);
    expect(current.events.find((e) => e.id === "departure")?.ticketManaged).toBe(true);
    current = await act(current, { action: "cancel", ticketId: companion.id, acknowledged: true });
    expect(await buildPlanRedlines(current)).toEqual([]);
    expect(current.events.find((e) => e.id === "departure")?.ticketManaged).toBe(false);
    expect((await plans.getPlanVersion(current.tripId, current.versionNumber)).tickets).toEqual(current.tickets);
    await expect(act(current, { action: "activate", ticket, acknowledged: true, importSource: { ...source, documentKind: "refund" } })).rejects.toThrow("退票资料");
  });
  it("uses only time-applicable saved routes and never shifts a no-service finding to another time", async () => {
    const original = await fixture();
    const current = await act(original, { action: "activate", acknowledged: true,
      ticket: core(original, { accessMode: "public_transit", accessDurationMinutes: 55, departureTime: "10:35", arrivalTime: "11:35", bufferMinutes: 10, chainOriginName: "早餐" }) });
    const route = manualReferenceRoute({ tripId: current.tripId, date: current.requestSnapshot.startDate!, edit: {
      fromEventId: "d1-breakfast", toEventId: "departure", departureTime: "08:45", manualReference: {
        availability: "available", durationMinutes: 55, fareCents: null, instructions: "合成演示", sourceName: "独立测试资料", sourceUrl: null,
        checkedAt: new Date().toISOString(), acknowledged: true,
      },
    } });
    const plan = { ...current, routeLegs: [route] };
    const result = (await buildPlanRedlines(plan, `${route.date}T00:45:00.000Z`))[0];
    expect(result.suggestedAt).toBe(`${route.date}T00:55:00.000Z`);
    expect(result.suggestedCheck?.routeApplicable).toBe(false); expect(result.currentCheck.routeApplicable).toBe(true);
    expect(result.precision).toBe("pending_confirmation"); expect(readCachedRoute(route.cacheKey)).toBeNull();
    const noService = { ...plan, routeLegs: [{ ...route, durationSeconds: null, status: "unavailable" as const }] };
    expect((await buildPlanRedlines(noService, `${route.date}T00:45:00.000Z`))[0].currentCheck.status).toBe("infeasible");
    expect((await buildPlanRedlines(noService, `${route.date}T01:05:00.000Z`))[0].currentCheck.status).toBe("unknown");
  });
  it("persists redline preferences in a new version, preserves facts and rejects stale writes", async () => {
    const original = await fixture();
    const current = await act(original, { action: "activate", acknowledged: true, ticket: core(original, { accessMode: "walking", accessDurationMinutes: 55, departureTime: "10:35", arrivalTime: "11:35", bufferMinutes: 10 }) });
    const old = await buildPlanRedlines(current, `${current.requestSnapshot.startDate}T00:47:00.000Z`);
    expect(old[0].suggestedAt?.slice(11, 16)).toBe("00:55");
    const preferences = { ...defaultRedlinePreferences(15), firstVisit: true, baggage: "none" as const };
    const saved = await act(current, { action: "update_redline", ticketId: current.tickets[0].id, preferences });
    expect(saved.versionNumber).toBe(current.versionNumber + 1);
    expect(saved.events).toEqual(current.events); expect(saved.costs).toEqual(current.costs); expect(saved.routeLegs).toEqual(current.routeLegs);
    expect(saved.tickets[0].departureTime).toBe("10:35"); expect(saved.tickets[0].redlinePreferences).toEqual(preferences);
    const reread = await plans.getPlanVersion(saved.tripId, saved.versionNumber);
    expect(reread.tickets[0].redlinePreferences).toEqual(preferences);
    const result = await buildPlanRedlines(reread, `${current.requestSnapshot.startDate}T00:47:00.000Z`);
    expect(result[0].suggestedAt?.slice(11, 16)).toBe("00:45");
    expect(result[0].calculationVersion).not.toBe(old[0].calculationVersion);
    await expect(act(current, { action: "update_redline", ticketId: current.tickets[0].id, preferences })).rejects.toThrow("计划已变化");
    const cancelled = await act(saved, { action: "cancel", ticketId: saved.tickets[0].id, acknowledged: true });
    expect(await buildPlanRedlines(cancelled)).toEqual([]);
    await expect(act(cancelled, { action: "update_redline", ticketId: saved.tickets[0].id, preferences })).rejects.toThrow("当前有效票");
  });

  it("uses the return origin, honors baggage applicability and preserves unknown airline cutoffs", async () => {
    const original = await fixture();
    let current = await act(original, { action: "activate", acknowledged: true, ticket: core(original, { eventId: "return", direction: "return", mode: "flight",
      chainOriginName: "返程住宿点", date: original.requestSnapshot.endDate, arrivalDate: original.requestSnapshot.endDate,
      departureTime: "17:00", arrivalTime: "18:30", accessMode: "walking", checkInCutoffMinutes: 45, bagDropCutoffMinutes: null, boardingCutoffMinutes: 20 }) });
    let result = await buildPlanRedlines(current);
    expect(result[0].input.origin).toBe("返程住宿点"); expect(result[0].precision).toBe("pending_confirmation");
    current = await act(current, { action: "update_redline", ticketId: current.tickets[0].id, preferences: { ...defaultRedlinePreferences(5), baggage: "none" } });
    result = await buildPlanRedlines(current);
    expect(result[0].input.steps.some((s) => s.id === "bag")).toBe(false);
    expect(result[0].input.deadlines.map((d) => d.id)).toEqual(["checkin", "boarding"]);
    const changed = await act(current, { action: "update_details", acknowledged: true, ticketId: current.tickets[0].id,
      ticket: { ...current.tickets[0], chainOriginName: "返程新地点", accessDurationMinutes: 60, bufferMinutes: 20 } });
    expect(ticketRedlineInput(changed, changed.tickets[0]).origin).toBe("返程新地点");
    expect(changed.tickets[0].redlinePreferences?.extraBufferSeconds).toBe(1200);
    expect((await buildPlanRedlines(changed))[0].suggestedAt).not.toBe(result[0].suggestedAt);
  });
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

  it("binds a ticket to the pre-existing paid cost only after explicit attribution", async () => {
    let current = await fixture();
    current = await pay(current, "cost-departure", 3000);
    const saved = await act(current, { action: "activate", acknowledged: true, ticket: core(current, { passengerCount: 2 }), costAllocation: { kind: "existing", costId: "cost-departure" } });
    const preserved = saved.costs.find((cost) => cost.id === "cost-departure")!;
    expect(preserved).toMatchObject({ unitAmountCents: 3000, paymentStatus: "paid", unit: "per_ticket", quantity: 1 });
    expect(preserved.note).toContain("用户已确认关联票据包含在本笔费用中");
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
    const beforeRedlines = await buildPlanRedlines(active, `${active.requestSnapshot.startDate}T00:00:00.000Z`);
    await db.$executeRawUnsafe("CREATE TRIGGER ticket_test_fail BEFORE UPDATE ON Trip BEGIN SELECT RAISE(ABORT, 'synthetic commit failure'); END");
    try {
      await expect(act(active, { action: "replace", ticketId: active.tickets[0].id, acknowledged: true,
        replacement: core(active, { serviceNumber: "G999" }), importResolution: "replacement",
        importSource: { engine: "tesseract-local", documentKind: "change", imageFingerprint: "c".repeat(64), cropFingerprint: "d".repeat(64), recognizedAt: new Date().toISOString() } })).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe("DROP TRIGGER ticket_test_fail");
    }
    const latest = (await plans.listPlanVersions(active.tripId))[0];
    expect(latest.versionNumber).toBe(active.versionNumber);
    expect(latest.tickets).toEqual(active.tickets);
    expect(latest.costs).toEqual(active.costs);
    expect(latest.isCurrent).toBe(true);
    expect(await buildPlanRedlines(latest, `${active.requestSnapshot.startDate}T00:00:00.000Z`)).toEqual(beforeRedlines);
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
