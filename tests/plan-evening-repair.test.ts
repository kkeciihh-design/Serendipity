import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { calculateBudgetSummary } from "../lib/budget";
import { emptyExecution } from "../lib/execution";
import { nextPlanDate, planEveningReturnGaps, validatePlan, type PlanEvent } from "../lib/plan";

let database: ReturnType<typeof isolatedDatabase>;
let prisma: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");

beforeAll(async () => {
  database = isolatedDatabase("plan-evening-repair");
  prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  trips = await import("../lib/trips");
  requests = await import("../lib/trip-request-service");
  plans = await import("../lib/plan-service");
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), trips.closeTripStore(), requests.closeTripRequestStore(), plans.closePlanStore()]);
  database.cleanup();
});

async function fixture() {
  const snapshot = requestFixture(3, { destination: "杭州", budgetAmountCents: 300000 });
  const trip = await trips.createTrip({ originalRequest: "杭州西湖三天慢旅行，保留用户原始想法" });
  const draft = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: snapshot });
  const confirmed = await requests.confirmRequest(trip.id, { expectedRequestRevision: draft.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, confirmed.requestRevision);
  const content = planFixture(snapshot);
  const saved = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, snapshot) });
  const originalEvents: PlanEvent[] = saved.events.map((event) => event.id === "d1-hotel" ? {
    ...event, startTime: "15:00", endTime: "15:30", title: "湖滨酒店寄存行李", locationName: "龙翔桥/湖滨商圈",
    latitude: 30.252, longitude: 120.165, coordinateSystem: "WGS84", suggestedDurationSeconds: 1800,
  } : event.id === "d2-hotel" ? { ...event, startTime: "17:30", endTime: "17:45", suggestedDurationSeconds: 900 }
    : event.id === "d1-activity" ? { ...event, note: "用户已确认的原文", status: "confirmed", locked: true } : event);
  const hotel = originalEvents.find((event) => event.id === "d1-hotel")!;
  originalEvents.push({ ...hotel, id: "d1-nightwalk", type: "activity", title: "西湖夜景", startTime: "19:00", endTime: "20:00", suggestedDurationSeconds: 3600, costDraftCents: 0 });
  const originalCosts = saved.costs.map((cost) => cost.linkedEventId === "d1-hotel" ? { ...cost, certainty: "user_confirmed", source: "user_confirmed", paymentStatus: "paid" } : cost);
  await prisma.planVersion.update({ where: { id: saved.id }, data: { events: JSON.stringify(originalEvents), costs: JSON.stringify(originalCosts) } });
  const original = await prisma.planVersion.findUniqueOrThrow({ where: { id: saved.id } });
  return { trip, saved, original };
}

const repairInput = (tripId: string, version = 1) => ({ tripId, expectedPlanVersion: version, expectedExecutionRevision: 0 });

describe("historical hotel return repair", () => {
  it("creates one editable free rest node, retaining original events, paid lodging, history, evidence and checklist progress", async () => {
    const { trip, saved, original } = await fixture();
    const checklist = await prisma.checklistState.findUniqueOrThrow({ where: { tripId: trip.id } });
    const items = JSON.parse(checklist.items);
    items[0].completed = true;
    items[0].completedAt = new Date().toISOString();
    await prisma.checklistState.update({ where: { tripId: trip.id }, data: { items: JSON.stringify(items) } });
    await prisma.evidenceFact.create({ data: {
      tripId: trip.id, planVersionId: saved.id, targetType: "event", targetId: "d1-activity", field: "location", status: "unverified",
      sourceTitle: "合成来源", sourceUrl: "https://example.com/fixture", sourcePublisher: "测试", extractedValue: "位置参考",
      searchProvider: "fixture", searchQuery: "合成位置", retrievedAt: new Date(), contentQuote: "合成资料，不涉及实际预约", lastRefreshStatus: "completed",
    } });
    const result = await plans.repairPlanEveningReturns(repairInput(trip.id));
    expect(result.outcome).toBe("repaired");
    expect(result.plan.versionNumber).toBe(2);
    expect(result.addedEvents).toHaveLength(1);
    const added = result.addedEvents[0];
    expect(added).toMatchObject({ dayNumber: 1, type: "rest", title: "返回酒店休息 · 龙翔桥/湖滨商圈", startTime: "20:00", endTime: "20:30",
      status: "suggested", locked: false, costDraftCents: 0, latitude: 30.252, longitude: 120.165 });
    const current = await prisma.planVersion.findUniqueOrThrow({ where: { id: result.plan.id } });
    const afterEvents: PlanEvent[] = JSON.parse(current.events);
    const beforeEvents: PlanEvent[] = JSON.parse(original.events);
    for (const event of beforeEvents) expect(afterEvents.find((item) => item.id === event.id)).toEqual(event);
    for (const field of ["costs", "requestSnapshot", "requestRevision", "pendingItems", "places", "routeLegs", "tickets"] as const) expect(current[field]).toBe(original[field]);
    expect(await prisma.planVersion.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    expect(planEveningReturnGaps(result.plan, result.plan.requestSnapshot)).toEqual([]);
    expect(calculateBudgetSummary(result.plan.costs, result.plan.requestSnapshot)).toEqual(calculateBudgetSummary(JSON.parse(original.costs), result.plan.requestSnapshot));
    expect(await prisma.evidenceFact.count({ where: { planVersionId: saved.id } })).toBe(1);
    expect(await prisma.evidenceFact.count({ where: { planVersionId: current.id, targetId: "d1-activity", lastRefreshStatus: "completed" } })).toBe(1);
    const latestChecklist = await prisma.checklistState.findUniqueOrThrow({ where: { tripId: trip.id } });
    expect(latestChecklist.planVersion).toBe(2);
    expect(latestChecklist.revision).toBe(checklist.revision + 1);
    expect(JSON.parse(latestChecklist.items).find((item: { id: string }) => item.id === items[0].id)).toMatchObject({ completed: true, completedAt: items[0].completedAt });
    const edited = await plans.savePlanEventEdit({ tripId: trip.id, expectedPlanVersion: 2,
      edit: { eventId: added.id, note: "晚上回店后早睡", status: "suggested", locked: false, remove: false, timeEdit: "preserve" } });
    expect(edited.events.find((event) => event.id === added.id)?.note).toBe("晚上回店后早睡");
  });

  it("previews without writes, then remains idempotent without creating another plan or checklist revision", async () => {
    const { trip, original } = await fixture();
    const preview = await plans.repairPlanEveningReturns({ ...repairInput(trip.id), dryRun: true });
    expect(preview.outcome).toBe("preview");
    expect(preview.addedEvents).toHaveLength(1);
    expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
    expect(await prisma.planVersion.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    const applied = await plans.repairPlanEveningReturns(repairInput(trip.id));
    const checklist = await prisma.checklistState.findUniqueOrThrow({ where: { tripId: trip.id } });
    const unchanged = await plans.repairPlanEveningReturns(repairInput(trip.id, 2));
    expect(unchanged.outcome).toBe("unchanged");
    expect(unchanged.plan.id).toBe(applied.plan.id);
    expect(unchanged.addedEvents).toEqual([]);
    expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
    expect(await prisma.checklistState.findUniqueOrThrow({ where: { tripId: trip.id } })).toEqual(checklist);
  });

  it("rejects stale plan or execution captures and a started journey without writing history", async () => {
    const { trip } = await fixture();
    await expect(plans.repairPlanEveningReturns(repairInput(trip.id, 2))).rejects.toThrow("当前计划版本已变化");
    await expect(plans.repairPlanEveningReturns({ ...repairInput(trip.id), expectedExecutionRevision: 1 })).rejects.toThrow("旅行执行进度已变化");
    await prisma.executionState.create({ data: { tripId: trip.id, planVersion: 1, revision: 3, payload: JSON.stringify({ ...emptyExecution(), startedAt: new Date().toISOString() }) } });
    await expect(plans.repairPlanEveningReturns({ ...repairInput(trip.id), expectedExecutionRevision: 3 })).rejects.toThrow("旅行已经开始");
    expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("refuses an automatic cross-midnight insertion instead of moving existing events", async () => {
    const { trip, original } = await fixture();
    const events = JSON.parse(original.events).map((event: PlanEvent) => event.id === "d1-nightwalk"
      ? { ...event, startTime: "23:30", endTime: "00:30", endDate: nextPlanDate(event.date) } : event);
    await prisma.planVersion.update({ where: { id: original.id }, data: { events: JSON.stringify(events) } });
    await expect(plans.repairPlanEveningReturns(repairInput(trip.id))).rejects.toThrow("跨午夜");
    expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
  });

  it("runs the maintenance script in preview and apply modes against only its explicit data directory", async () => {
    const { trip } = await fixture();
    const args = [path.resolve("scripts/repair-evening-returns.mjs"), "--data-dir", database.directory,
      "--trip", trip.id, "--version", "1", "--execution-revision", "0"];
    const preview = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({ outcome: "preview", expectedPlanVersion: 1, expectedExecutionRevision: 0, planVersion: 1 });
    expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(1);
    const applied = spawnSync(process.execPath, [...args, "--apply"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    expect(applied.status, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ outcome: "repaired", planVersion: 2 });
    expect(await prisma.planVersion.count({ where: { tripId: trip.id } })).toBe(2);
  });
});
