import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validatePlan } from "../lib/plan";
import type { ChecklistAction, ChecklistView } from "../lib/checklist";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { isolatedDatabase } from "./helpers/test-database";

let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service"), plans: typeof import("../lib/plan-service"), service: typeof import("../lib/checklist-service");
beforeAll(async () => { database = isolatedDatabase("unit-checklist"); db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } }); trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service"); service = await import("../lib/checklist-service"); });
afterAll(async () => { await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), service?.closeChecklistStore(), db?.$disconnect()]); database?.cleanup(); });
async function fixture() {
  const trip = await trips.createTrip({ originalRequest: "阶段20合成清单演练" });
  const request = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture() });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: request.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, request.requestRevision), content = planFixture(capture.requestSnapshot);
  return plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
}
const write = (view: ChecklistView, change: ChecklistAction) => service.saveChecklist(view.tripId, { expectedPlanVersion: view.planVersion, expectedRevision: view.revision, expectedBasis: view.basis, change });
const custom = () => ({ action: "add" as const, id: crypto.randomUUID(), fields: { title: "带个人常用物品", group: "essentials" as const, note: "合成数据", date: null, eventId: null } });
describe("清单独立持久化及计划事务", () => {
  it("persists toggle and cancellation across reopen without changing tickets, costs or plan versions", async () => {
    const p = await fixture(); let view = await service.getChecklist(p.tripId, 1);
    const before = await db.planVersion.findUniqueOrThrow({ where: { id: p.id } });
    view = await write(view, { action: "complete", id: "transport:departure", completed: true });
    await service.closeChecklistStore(); expect(await service.getChecklist(p.tripId, 1)).toEqual(view);
    expect(await db.planVersion.findUniqueOrThrow({ where: { id: p.id } })).toEqual(before);
    expect(await plans.listPlanVersions(p.tripId)).toHaveLength(1);
    view = await write(view, { action: "complete", id: "transport:departure", completed: false });
    expect(view.items.find((i) => i.id === "transport:departure")).toMatchObject({ completed: false, completedAt: null });
  });
  it("allows one concurrent write, rejects stale retries and keeps idempotent explicit-state saves", async () => {
    const p = await fixture(), view = await service.getChecklist(p.tripId, 1), change = { action: "complete" as const, id: "essential:phone", completed: true };
    const results = await Promise.allSettled([write(view, change), write(view, change)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = await service.getChecklist(p.tripId, 1);
    expect(await write(saved, change)).toEqual(saved);
    await expect(write(view, custom())).rejects.toMatchObject({ status: 409 });
  });
  it("merges the latest check and custom item made while generation is in flight", async () => {
    const p = await fixture(), capture = await plans.getPlanGenerationContext(p.tripId, p.requestRevision);
    let view = await service.getChecklist(p.tripId, 1);
    view = await write(view, custom()); view = await write(view, { action: "complete", id: "essential:phone", completed: true });
    const content = planFixture(capture.requestSnapshot); content.events.forEach((e) => e.id = `regenerated-${e.id}`);
    const saved = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
    const after = await service.getChecklist(p.tripId, saved.versionNumber);
    expect(after.items.find((i) => i.id === "essential:phone")).toMatchObject({ completed: true });
    expect(after.items.filter((i) => i.custom)).toEqual(view.items.filter((i) => i.custom));
    expect(after.items.filter((i) => i.group === "transport" && !i.orphaned)).toHaveLength(2);
    expect(after.revision).toBe(view.revision + 1);
    expect(await write(after, { action: "sync" })).toEqual(after);
    await expect(write(view, custom())).rejects.toMatchObject({ status: 409 });
    await expect(service.getChecklist(p.tripId, 1)).rejects.toMatchObject({ status: 409 });
  });
  it("edits/removes/restores custom content, rejects duplicate creation and retains it after request changes", async () => {
    const p = await fixture(), add = custom(); let view = await service.getChecklist(p.tripId, 1);
    view = await write(view, add); const id = `custom:${add.id}`;
    await expect(write(view, add)).rejects.toMatchObject({ status: 409 });
    view = await write(view, { action: "edit", id, fields: { ...add.fields, title: "带相机与备用电池" } });
    view = await write(view, { action: "delete", id }); view = await write(view, { action: "sync" });
    expect(view.items.find((i) => i.id === id)?.deleted).toBe(true);
    view = await write(view, { action: "restore", id });
    await requests.saveRequestDraft(p.tripId, { expectedRequestRevision: p.requestRevision, request: { ...p.requestSnapshot, destination: "北京" } });
    view = await write(view, { action: "complete", id, completed: true });
    expect(view.items.find((i) => i.id === id)).toMatchObject({ title: "带相机与备用电池", completed: true });
    expect((await plans.getPlanVersion(p.tripId, 1)).requestSnapshot.destination).toBe("长沙");
  });
  it("active ticket confirmation and cancellation refresh relationships without treating checks as booking facts", async () => {
    let p = await fixture(), view = await service.getChecklist(p.tripId, 1);
    await write(view, { action: "complete", id: "transport:departure", completed: true });
    p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, action: { action: "activate", ticket: ticketFixture(p.requestSnapshot.startDate!), acknowledged: true } });
    view = await service.getChecklist(p.tripId, p.versionNumber);
    expect(view.items.find((i) => i.id === "transport:departure")).toMatchObject({ ticketIds: [p.tickets[0].id], completed: false, officialUrl: "https://www.12306.cn/" });
    p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, action: { action: "cancel", ticketId: p.tickets[0].id, acknowledged: true } });
    view = await service.getChecklist(p.tripId, p.versionNumber);
    expect(view.items.find((i) => i.id === "transport:departure")?.ticketIds).toEqual([]);
    expect(p.tickets[0].status).toBe("cancelled");
  });
  it("rolls back a plan edit and its pointer if checklist synchronization fails", async () => {
    const p = await fixture(); const count = await db.planVersion.count({ where: { tripId: p.tripId } });
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_checklist BEFORE UPDATE ON ChecklistState BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    try {
      await expect(plans.savePlanEventEdit({ tripId: p.tripId, expectedPlanVersion: 1, edit: { eventId: "d1-rest", timeEdit: "preserve", note: "改备注", locked: false, status: "suggested", remove: false } })).rejects.toThrow();
      expect(await db.planVersion.count({ where: { tripId: p.tripId } })).toBe(count);
      expect((await db.trip.findUniqueOrThrow({ where: { id: p.tripId } })).currentPlanVersionId).toBe(p.id);
    } finally { await db.$executeRawUnsafe("DROP TRIGGER fail_checklist"); }
  });
  it("initializes legacy plans lazily, keeps GET read-only and cascades checklist deletion with its trip", async () => {
    const p = await fixture(); await db.checklistState.delete({ where: { tripId: p.tripId } });
    const view = await service.getChecklist(p.tripId, 1); expect(view.revision).toBe(0);
    expect(await db.checklistState.findUnique({ where: { tripId: p.tripId } })).toBeNull();
    await write(view, custom());
    await trips.deleteTrip(p.tripId);
    expect(await db.checklistState.findUnique({ where: { tripId: p.tripId } })).toBeNull();
  });
  it("includes existing reservation evidence and rejects writes based on stale source content", async () => {
    const p = await fixture(), view = await service.getChecklist(p.tripId, 1);
    await db.evidenceFact.create({ data: { tripId: p.tripId, planVersionId: p.id, targetType: "event", targetId: "d1-activity", field: "reservation", status: "unverified", sourceTitle: "合成预约资料", sourceUrl: "https://example.invalid", sourcePublisher: "测试", extractedValue: "需要预约", searchProvider: "test", searchQuery: "test", retrievedAt: new Date(), contentQuote: "预约要求尚未核实" } });
    await expect(write(view, { action: "complete", id: "essential:phone", completed: true })).rejects.toThrow("关联资料已变化");
    const refreshed = await service.getChecklist(p.tripId, 1);
    expect(refreshed.items.find((i) => i.id === "reservation:d1-activity")).toMatchObject({ completed: false, sourceLabel: expect.stringContaining("待复核"), officialUrl: null });
    expect((await write(refreshed, { action: "complete", id: "essential:phone", completed: true })).items.find((i) => i.id === "essential:phone")?.completed).toBe(true);
  });
});
