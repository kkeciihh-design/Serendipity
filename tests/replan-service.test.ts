import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { isolatedDatabase } from "./helpers/test-database";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { ticketFixture } from "./helpers/ticket-fixtures";
import { verificationEvidenceDirectory } from "./helpers/evidence-directory";
import { preparePlanForStorage, validatePlan } from "../lib/plan";
import { calculateBudgetSummary, derivePlanCosts } from "../lib/budget";
import { applyReplanProposal, protectedEvent, type ReplanProposal } from "../lib/replan";
import type { PlanVersionRecord } from "../lib/plan-service";
import type { AICompletionResult } from "../lib/ai-adapter";
import type { RequestSnapshot } from "../lib/trip-request";
vi.mock("../lib/settings", () => ({ storedAIConfiguration: async () => ({ provider: "openai-chat-completions", baseUrl: "http://127.0.0.1:9999", model: "isolated-test", apiKey: "test-only", basePrompt: "", systemPrompt: "" }) }));
let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient;
let trips: typeof import("../lib/trips"), requests: typeof import("../lib/trip-request-service"), plans: typeof import("../lib/plan-service"), service: typeof import("../lib/replan-service"), checklist: typeof import("../lib/checklist-service");
beforeAll(async () => { database = isolatedDatabase("unit-replan"); db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } }); trips = await import("../lib/trips"); requests = await import("../lib/trip-request-service"); plans = await import("../lib/plan-service"); service = await import("../lib/replan-service"); checklist = await import("../lib/checklist-service"); });
afterAll(async () => { await Promise.all([trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore(), service?.closeReplanStore(), checklist?.closeChecklistStore(), db?.$disconnect()]); database?.cleanup(); });
const edit = (eventId = "d2-activity", fields: ReplanProposal["edits"][number]["fields"] = { note: "下雨改在室内停留" }): ReplanProposal => ({ requirementChange: null, edits: [{ eventId, remove: false, fields }] });
const completion = (value = edit()) => async (): Promise<AICompletionResult> => ({ ok: true, content: JSON.stringify(value) });
const input = (p: PlanVersionRecord) => ({ tripId: p.tripId, reason: "下雨了", expectedPlanVersion: p.versionNumber, expectedRequestRevision: p.requestRevision });
const at = (p: PlanVersionRecord, time: string) => new Date(`${p.requestSnapshot.startDate}T${time}+08:00`).toISOString();
async function fixture(t31 = false, requestOverrides: Partial<RequestSnapshot> = {}) {
  const trip = await trips.createTrip({ originalRequest: "阶段22隔离重规划演练" });
  const request = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: requestFixture(2, requestOverrides) });
  await requests.confirmRequest(trip.id, { expectedRequestRevision: request.requestRevision });
  const capture = await plans.getPlanGenerationContext(trip.id, request.requestRevision), content = planFixture(capture.requestSnapshot);
  if (t31) {
    Object.assign(content.events.find((e) => e.id === "departure")!, { startTime: "10:35", endTime: "11:00" });
    Object.assign(content.events.find((e) => e.id === "d1-activity")!, { startTime: "11:10", endTime: "12:00" });
  }
  let p = await plans.savePlanVersion({ capture, plan: content, validationResults: validatePlan(content, capture.requestSnapshot) });
  if (t31) p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, action: { action: "activate", acknowledged: true,
    ticket: ticketFixture(p.requestSnapshot.startDate!, { departureTime: "10:35", arrivalTime: "11:00", accessMode: "walking", accessDurationMinutes: 55, accessFareCents: 0, bufferMinutes: 10 }) } });
  return p;
}
async function state(p: PlanVersionRecord) { return { trip: await db.trip.findUnique({ where: { id: p.tripId } }), plans: await db.planVersion.findMany({ where: { tripId: p.tripId } }), checklist: await db.checklistState.findUnique({ where: { tripId: p.tripId } }) }; }
async function evidence(name: string, value: unknown) { const directory = verificationEvidenceDirectory("phase22-core"); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(value, null, 2)); }
describe("阶段22：候选、时间与原子提交", () => {
  it("retries a delete-only rain response into a concrete indoor replacement and connected transport", async () => {
    const original = await fixture();
    const activity = original.events.find((event) => event.id === "d2-activity")!;
    const events = original.events.map((event) => event.id === activity.id ? { ...event, title: "洛伽寺拍照", locationName: "洛伽寺", latitude: 24.8519, longitude: 118.6466 } : event);
    events.push({ ...activity, id: "rain-in", type: "local_transport", title: "打车至洛伽寺", locationName: "洛伽寺", startTime: "09:30", endTime: "10:00" },
      { ...activity, id: "rain-out", type: "local_transport", title: "洛伽寺返回西街", locationName: "西街", startTime: "12:00", endTime: "12:30" });
    await db.planVersion.update({ where: { id: original.id }, data: { events: JSON.stringify(events), costs: JSON.stringify(derivePlanCosts(events)) } });
    const p = await plans.getPlanVersion(original.tripId, original.versionNumber);
    let calls = 0;
    const candidate = await service.previewReplan({ ...input(p), reason: "第2天下雨，把洛伽寺改成室内博物馆并调整交通" }, { completion: async (args) => {
      calls++;
      if (calls === 1) return completion({ requirementChange: null, edits: ["d2-activity", "rain-in", "rain-out"].map((eventId) => ({ eventId, remove: true, fields: {} })) })();
      expect(args.userPrompt).toContain("替换目标未完成");
      return completion({ requirementChange: null, edits: [
        { eventId: "d2-activity", remove: false, fields: { title: "泉州海外交通史博物馆", locationName: "泉州海外交通史博物馆", costDraftCents: 0 } },
        { eventId: "rain-in", remove: false, fields: { title: "打车至海外交通史博物馆", locationName: "泉州海外交通史博物馆" } },
        { eventId: "rain-out", remove: false, fields: { title: "博物馆返回西街" } },
      ] })();
    } });
    expect(calls).toBe(2);
    expect(candidate.summary.added).toContain("泉州海外交通史博物馆");
    expect(candidate.plan.events.find((event) => event.id === activity.id)?.latitude).toBeNull();
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(1);
  });
  it("blocks a draft whose lower cost fits but explicit upper price exceeds the hard budget", async () => {
    const p = await fixture(false, { constraints: ["总预算不超过1500元"] });
    await expect(service.previewReplan(input(p), { completion: completion({ requirementChange: null, edits: [], additions: [
      { type: "local_transport", dayNumber: 2, date: p.requestSnapshot.endDate!, startTime: "09:00", endTime: "09:30", title: "打车前往博物馆", locationName: "博物馆", costDraftCents: 1000, note: "网约车费用约10-2000元" },
    ] }) })).rejects.toThrow("预算上限");
    expect(await db.replanCandidate.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it.each(["rain", "late", "remove"])("%s previews and applies with current R and one shared plan/checklist version", async (kind) => {
    const p = await fixture(), proposal = kind === "rain" ? edit("d2-activity", { title: "室内展览", locationName: "市内展馆", costDraftCents: 3000 })
      : kind === "late" ? edit("d2-breakfast", { startTime: "09:00", endTime: "09:30" })
      : { requirementChange: null, edits: [{ eventId: "d2-activity", remove: true, fields: {} }] };
    const before = await state(p), c = await service.previewReplan(input(p), { completion: completion(proposal) });
    expect(await state(p)).toEqual(before);
    await service.closeReplanStore(); expect((await service.getReplanState(p.tripId)).candidate?.id).toBe(c.id);
    const result = await service.applyReplan(p.tripId, c.id, c.revision);
    expect(result.outcome).toBe("applied"); if (result.outcome !== "applied") return;
    expect(result.plan.requestRevision).toBe(p.requestRevision); expect(result.plan.requestSnapshot).toEqual(p.requestSnapshot);
    expect((await checklist.getChecklist(p.tripId, result.plan.versionNumber)).planVersion).toBe(result.plan.versionNumber);
    expect(result.plan.validationResults.errors).toEqual([]);
    // Subsequent ordinary edits must preserve the remaining-plan rules.
    const edited = await plans.savePlanEventEdit({ tripId: p.tripId, expectedPlanVersion: result.plan.versionNumber, edit: { eventId: "d2-rest", timeEdit: "preserve", note: "后续普通编辑", locked: false, status: "suggested", remove: false } });
    expect(edited.validationResults.scope).toBe("remaining");
  });
  it("T31: only the clock changes from 09:00 to 09:06, 10:25 becomes 10:31 and no plan commits", async () => {
    const p = await fixture(true); let now = at(p, "09:00:00"); const deps = { completion: completion(), now: () => now };
    const c = await service.previewReplan(input(p), deps), before = await state(p);
    expect(c.redlines[0].currentCheck.deadlines.find((d) => d.id === "boarding")?.arrivalAt).toBe(at(p, "10:25:00"));
    expect(c.redlines[0].currentCheck.status).toBe("insufficient_margin");
    now = at(p, "09:06:00");
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, deps)).rejects.toThrow("赶不上");
    expect(await state(p)).toEqual(before);
    const rechecked = await (await import("../lib/redline-service")).buildPlanRedlines(c.plan, now);
    await evidence("T31", { previewAt: c.verifiedAt, previewCheck: c.redlines[0].currentCheck, applyAt: now, applyCheck: rechecked[0].currentCheck,
      outcome: "rejected", requestRevision: c.requestRevision, planVersion: c.baseVersion, checklistRevision: c.checklistRevision, allBusinessRowsUnchanged: JSON.stringify(await state(p)) === JSON.stringify(before) });
    now = at(p, "10:40:00");
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, deps)).rejects.toThrow("赶不上");
  });
  it("ordinary elapsed countdown with the same material plan does not demand a second confirmation", async () => {
    const p = await fixture(true); let now = at(p, "09:00:00"); const deps = { completion: completion(), now: () => now };
    const c = await service.previewReplan(input(p), deps); now = at(p, "09:01:00");
    expect((await service.applyReplan(p.tripId, c.id, c.revision, undefined, deps)).outcome).toBe("applied");
  });
  it("a fixed return that becomes unreachable is rejected without moving its ticket or losing the later preparation", async () => {
    let p = await fixture();
    const extra = { ...p.events.find((e) => e.id === "d2-preparation")!, id: "after-return", startTime: "20:00", endTime: "20:15", title: "返家后整理" };
    const content = preparePlanForStorage({ events: [...p.events, extra], pendingItems: p.pendingItems });
    await db.planVersion.update({ where: { id: p.id }, data: { events: JSON.stringify(content.events), costs: JSON.stringify([...p.costs, ...derivePlanCosts([extra])]) } });
    p = await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: 1, action: { action: "activate", acknowledged: true,
      ticket: ticketFixture(p.requestSnapshot.endDate!, { eventId: "return", direction: "return", departureTime: "17:00", arrivalDate: p.requestSnapshot.endDate!, arrivalTime: "18:30", accessMode: "walking", accessDurationMinutes: 55, accessFareCents: 0, bufferMinutes: 10 }) } });
    let now = new Date(`${p.requestSnapshot.endDate}T15:00:00+08:00`).toISOString();
    const deps = { completion: completion(edit("after-return")), now: () => now }, c = await service.previewReplan(input(p), deps), before = await state(p);
    now = new Date(`${p.requestSnapshot.endDate}T15:31:00+08:00`).toISOString();
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, deps)).rejects.toThrow("赶不上");
    expect(await state(p)).toEqual(before);
  });
  it("window expires after review but before transaction, even though every version matches", async () => {
    const p = await fixture(true); let now = at(p, "09:04:30"); const deps = { completion: completion(), now: () => now };
    const c = await service.previewReplan(input(p), deps), before = await state(p);
    expect(c.validUntil).toBe(at(p, "09:05:00"));
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, { ...deps, beforeCommit: async () => { now = at(p, "09:05:00"); } })).rejects.toThrow("窗口");
    expect(await state(p)).toEqual(before);
    await evidence("commit-window", { verifiedAt: c.verifiedAt, validUntil: c.validUntil, commitClock: now, outcome: "rejected", allBusinessRowsUnchanged: JSON.stringify(await state(p)) === JSON.stringify(before) });
  });
  it("window expiring during the final local writes rolls back the new plan, pointer and checklist", async () => {
    const p = await fixture(true); let commits = false, reads = 0;
    const now = () => commits && ++reads > 1 ? at(p, "09:05:00") : at(p, "09:04:30");
    const c = await service.previewReplan(input(p), { completion: completion(), now }), before = await state(p);
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, { now, beforeCommit: async () => { commits = true; } })).rejects.toThrow("提交期间");
    expect(await state(p)).toEqual(before);
    expect((await db.replanCandidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("preview");
  });
  it("a rechecked fare change requires a new preview before any new version can commit", async () => {
    const p = await fixture(), c = await service.previewReplan(input(p), { completion: completion() });
    const result = await service.applyReplan(p.tripId, c.id, c.revision, undefined, { routes: async (_base, proposed) => {
      const plan = structuredClone(proposed); plan.costs.find((cost) => cost.linkedEventId === "d2-activity")!.unitAmountCents = 9900;
      return { plan, warnings: ["复核费用已改变"] };
    } });
    expect(result.outcome).toBe("review_required"); expect((await plans.listPlanVersions(p.tripId)).length).toBe(1);
    await evidence("fare-recheck", { outcome: result.outcome, planCount: (await plans.listPlanVersions(p.tripId)).length,
      oldCost: c.plan.costs.find((cost) => cost.linkedEventId === "d2-activity"), newCost: result.outcome === "review_required" ? result.candidate.plan.costs.find((cost) => cost.linkedEventId === "d2-activity") : null });
  });
  it.each(["总预算不超过1000元", "总预算不超过1000元。最好少走路", "最好少走路，总预算控制在1000元以内"])("rejects the review's 2216-yuan proposal against '%s' without storing a candidate", async (constraint) => {
    const p = await fixture(false, { budgetAmountCents: 100000, constraints: ["不自驾", constraint] }), before = await state(p);
    const proposal = edit("d2-activity", { title: "室内活动", locationName: "室内馆", costDraftCents: 200000 });
    const proposed = applyReplanProposal(p, p.requestSnapshot, p.requestRevision, proposal, new Date().toISOString());
    expect(calculateBudgetSummary(proposed.costs, proposed.requestSnapshot).totalMinCents).toBe(221600);
    await expect(service.previewReplan(input(p), { completion: completion(proposal) })).rejects.toThrow("明确预算上限");
    expect(await state(p)).toEqual(before);
    expect(await db.replanCandidate.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it.each(["总预算1000元左右", "总预算尽量不超过1000元", "总预算尽量控制在1000元以内。最好少走路"])("keeps the soft preference '%s' as a warning and allows the reviewed proposal", async (constraint) => {
    const p = await fixture(false, { budgetAmountCents: 100000, constraints: [constraint] });
    const c = await service.previewReplan(input(p), { completion: completion(edit("d2-activity", { costDraftCents: 200000 })) });
    expect(c.warnings.join()).toContain("预算");
    const result = await service.applyReplan(p.tripId, c.id, c.revision);
    expect(result.outcome).toBe("applied");
  });
  it("uses the latest confirmed request's hard limit instead of the base plan's old budget", async () => {
    const p = await fixture(), request = await requests.saveRequestDraft(p.tripId, { expectedRequestRevision: p.requestRevision,
      request: { ...p.requestSnapshot, budgetAmountCents: 100000, constraints: ["总预算不超过1000元"] } });
    await requests.confirmRequest(p.tripId, { expectedRequestRevision: request.requestRevision });
    await expect(service.previewReplan({ ...input(p), expectedRequestRevision: request.requestRevision }, {
      completion: completion(edit("d2-activity", { costDraftCents: 200000 })),
    })).rejects.toThrow("明确预算上限");
    expect((await plans.listPlanVersions(p.tripId))).toHaveLength(1);
  });
  it("scales an explicit per-person limit to the confirmed traveler count and permits the exact boundary", async () => {
    const p = await fixture(false, { budgetAmountCents: 100000, budgetScope: "per_person", travelerCount: 2, constraints: ["每人预算不超过1000元"] });
    const c = await service.previewReplan(input(p), { completion: completion(edit("d2-activity", { costDraftCents: 178400 })) });
    expect(calculateBudgetSummary(c.plan.costs, c.plan.requestSnapshot).totalMinCents).toBe(200000);
    expect((await service.applyReplan(p.tripId, c.id, c.revision)).outcome).toBe("applied");
  });
  it.each(["总预算不超过1000元", "总预算不超过1000元。最好少走路"])("rechecks '%s' after application-time route prices change and retains the original plan and candidate", async (constraint) => {
    const p = await fixture(false, { budgetAmountCents: 100000, constraints: [constraint] });
    const c = await service.previewReplan(input(p), { completion: completion() }), before = await state(p);
    const candidateBefore = await db.replanCandidate.findUniqueOrThrow({ where: { id: c.id } });
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, { routes: async (_base, proposed) => {
      const plan = structuredClone(proposed); plan.costs.find((cost) => cost.linkedEventId === "d2-activity")!.unitAmountCents = 200000;
      return { plan, warnings: [] };
    } })).rejects.toThrow("明确预算上限");
    expect(await state(p)).toEqual(before);
    expect(await db.replanCandidate.findUniqueOrThrow({ where: { id: c.id } })).toEqual(candidateBefore);
  });
  it("material recheck changes are shown again, never silently applied; external work holds no transaction", async () => {
    const p = await fixture(), c = await service.previewReplan(input(p), { completion: completion() });
    const result = await service.applyReplan(p.tripId, c.id, c.revision, undefined, { routes: async (_base, proposed) => {
      // A separate client write succeeds: the external-work callback holds no SQLite transaction.
      await db.trip.update({ where: { id: p.tripId }, data: { title: "事务外查询探针" } });
      const plan = structuredClone(proposed); plan.events.find((e) => e.id === "d2-activity")!.endTime = "11:50";
      return { plan, warnings: [] };
    } });
    expect(result.outcome).toBe("review_required"); expect((await plans.listPlanVersions(p.tripId)).length).toBe(1);
    await evidence("material-recheck", { outcome: result.outcome, planCount: (await plans.listPlanVersions(p.tripId)).length,
      oldEvent: c.plan.events.find((e) => e.id === "d2-activity"), newEvent: result.outcome === "review_required" ? result.candidate.plan.events.find((e) => e.id === "d2-activity") : null,
      externalProbeTitle: (await db.trip.findUniqueOrThrow({ where: { id: p.tripId } })).title });
    await expect(service.applyReplan(p.tripId, c.id, c.revision)).rejects.toThrow("候选");
    if (result.outcome === "review_required") expect((await service.applyReplan(p.tripId, c.id, result.candidate.revision)).outcome).toBe("applied");
  });
  it("a newer confirmed request is captured, never the base plan snapshot", async () => {
    const p = await fixture(); const request = await requests.saveRequestDraft(p.tripId, { expectedRequestRevision: p.requestRevision, request: { ...p.requestSnapshot, travelerCount: 3 } });
    await requests.confirmRequest(p.tripId, { expectedRequestRevision: request.requestRevision });
    let prompt = "";
    const c = await service.previewReplan({ ...input(p), expectedRequestRevision: request.requestRevision }, { completion: async (args) => { prompt = args.userPrompt; return completion()(); } });
    expect(prompt).toContain('"travelerCount":3'); expect(c.requestRevision).toBe(request.requestRevision);
    const result = await service.applyReplan(p.tripId, c.id, c.revision);
    if (result.outcome !== "applied") throw new Error("unexpected repreview");
    expect(result.plan.requestSnapshot.travelerCount).toBe(3); expect(result.plan.requestRevision).toBe(request.requestRevision);
  });
  it.each(["request", "ticket", "event"])("%s edits during model work reject the stale candidate without relabeling R/V", async (kind) => {
    const p = await fixture();
    await expect(service.previewReplan(input(p), { completion: async () => {
      if (kind === "request") await requests.saveRequestDraft(p.tripId, { expectedRequestRevision: p.requestRevision, request: { ...p.requestSnapshot, travelerCount: 3 } });
      else if (kind === "ticket") await plans.savePlanTicketEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, action: { action: "activate", acknowledged: true, ticket: ticketFixture(p.requestSnapshot.startDate!) } });
      else await plans.savePlanEventEdit({ tripId: p.tripId, expectedPlanVersion: p.versionNumber, edit: { eventId: "d2-activity", timeEdit: "preserve", note: "已经确认", locked: true, status: "confirmed", remove: false } });
      return completion()();
    } })).rejects.toThrow();
    expect(await db.replanCandidate.count({ where: { tripId: p.tripId } })).toBe(0);
  });
  it("checklist changes during generation merge; changes after preview require another review", async () => {
    const p = await fixture();
    const mark = async () => { const v = await checklist.getChecklist(p.tripId, p.versionNumber); return checklist.saveChecklist(p.tripId, { expectedPlanVersion: v.planVersion, expectedRevision: v.revision, expectedBasis: v.basis, change: { action: "complete", id: "essential:phone", completed: true } }); };
    const c = await service.previewReplan(input(p), { completion: async () => { await mark(); return completion()(); } });
    expect(c.checklist.find((i) => i.id === "essential:phone")?.completed).toBe(true);
    const v = await checklist.getChecklist(p.tripId, p.versionNumber);
    await checklist.saveChecklist(p.tripId, { expectedPlanVersion: v.planVersion, expectedRevision: v.revision, expectedBasis: v.basis, change: { action: "add", id: crypto.randomUUID(), fields: { title: "个人物品", group: "essentials", note: "", date: null, eventId: null } } });
    const result = await service.applyReplan(p.tripId, c.id, c.revision); expect(result.outcome).toBe("review_required");
    if (result.outcome === "review_required") {
      expect(result.candidate.checklist.some((i) => i.title === "个人物品")).toBe(true);
      expect((await service.applyReplan(p.tripId, c.id, result.candidate.revision)).outcome).toBe("applied");
    }
  });
  it("state changes just before commit are rejected and latest preparation survives", async () => {
    const p = await fixture(), c = await service.previewReplan(input(p), { completion: completion() });
    await expect(service.applyReplan(p.tripId, c.id, c.revision, undefined, { beforeCommit: async () => {
      await db.checklistState.update({ where: { tripId: p.tripId }, data: { revision: { increment: 1 } } });
    } })).rejects.toThrow("刚有更新");
    expect((await plans.listPlanVersions(p.tripId)).length).toBe(1);
  });
  it("cancel, abort, model timeout and failed final write preserve the existing plan atomically", async () => {
    const p = await fixture(), before = await state(p);
    await expect(service.previewReplan(input(p), { completion: async () => ({ ok: false, category: "timeout", message: "模拟超时" }) })).rejects.toThrow("超时");
    const abort = new AbortController();
    await expect(service.previewReplan({ ...input(p), signal: abort.signal }, { completion: async () => { abort.abort(); return completion()(); } })).rejects.toThrow("取消");
    const c = await service.previewReplan(input(p), { completion: completion() }); await service.cancelReplan(p.tripId, c.id, c.revision);
    await expect(service.applyReplan(p.tripId, c.id, c.revision)).rejects.toThrow("取消");
    const fresh = await service.previewReplan(input(p), { completion: completion() });
    await db.$executeRawUnsafe("CREATE TRIGGER fail_replan BEFORE UPDATE ON ReplanCandidate WHEN NEW.status = 'applied' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    try { await expect(service.applyReplan(p.tripId, fresh.id, fresh.revision)).rejects.toThrow(); expect(await state(p)).toEqual(before); }
    finally { await db.$executeRawUnsafe("DROP TRIGGER fail_replan"); }
  });
  it("requirement changes return to the existing confirm flow and cannot mutate a snapshot", async () => {
    const p = await fixture(), before = await state(p);
    await expect(service.previewReplan({ ...input(p), reason: "改去上海，3个人" }, { completion: completion({ requirementChange: "目的地与人数改变", edits: [] }) })).rejects.toMatchObject({ status: 422 });
    expect(await state(p)).toEqual(before);
  });
  it("undo creates a preview/new version, preserves current facts and rechecks the clock", async () => {
    const p = await fixture(), c = await service.previewReplan(input(p), { completion: completion(edit("d2-activity", { title: "新展览", locationName: "新展馆" })) });
    const applied = await service.applyReplan(p.tripId, c.id, c.revision); if (applied.outcome !== "applied") throw new Error("not applied");
    const undo = await service.previewUndo(input(applied.plan)); expect((await plans.listPlanVersions(p.tripId)).length).toBe(2);
    const result = await service.applyReplan(p.tripId, undo.id, undo.revision); if (result.outcome !== "applied") throw new Error("not applied");
    expect(result.plan.events).toEqual(p.events); expect(result.plan.tickets).toEqual(p.tickets); expect(result.plan.versionNumber).toBe(3);
    await expect(service.applyReplan(p.tripId, c.id, c.revision)).rejects.toThrow();
  });
  it("active tickets, locked/confirmed/started events and paid costs are protected; inactive tickets impose no hard constraint", async () => {
    const p = await fixture(true), now = at(p, "09:00:00");
    for (const target of ["departure", "d1-breakfast"]) expect(() => applyReplanProposal(p, p.requestSnapshot, p.requestRevision, edit(target, { note: "修改" }), now)).toThrow("保留");
    const locked = structuredClone(p); locked.events.find((e) => e.id === "d2-activity")!.locked = true;
    expect(() => applyReplanProposal(locked, p.requestSnapshot, p.requestRevision, edit(), now)).toThrow("保留");
    for (const status of ["draft", "cancelled", "replaced"] as const) {
      const inactive = structuredClone(p); inactive.tickets[0].status = status; const event = inactive.events.find((e) => e.id === "departure")!; event.locked = false; event.status = "suggested";
      inactive.costs = inactive.costs.filter((c) => c.linkedEventId !== event.id);
      expect(protectedEvent(inactive, event, now)).toBe(false);
    }
    const paid = structuredClone(p); paid.costs.find((c) => c.linkedEventId === "d2-activity")!.paymentStatus = "paid";
    expect(() => applyReplanProposal(paid, paid.requestSnapshot, paid.requestRevision, edit(), now)).toThrow("保留");
  });
});
