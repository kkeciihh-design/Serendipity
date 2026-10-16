import { describe, expect, it } from "vitest";
import { applyChecklistAction, deriveChecklist, mergeChecklist } from "../lib/checklist-merge";
import { checklistWriteSchema, parseChecklistItems } from "../lib/checklist";
import { preparePlanForStorage, validatePlan } from "../lib/plan";
import { derivePlanCosts } from "../lib/budget";
import type { PlanVersionRecord } from "../lib/plan-service";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

function fixture(): PlanVersionRecord {
  const snapshot = requestFixture(), content = preparePlanForStorage(planFixture(snapshot));
  const museum = content.events.find((e) => e.id === "d1-activity")!; museum.title = museum.locationName = "湖南博物院";
  return { id: "p", tripId: "t", versionNumber: 1, requestRevision: 1, requestSnapshot: snapshot, ...content,
    costs: derivePlanCosts(content.events), tickets: [], places: [], routeLegs: [], validationResults: validatePlan(content, snapshot), isCurrent: true, requirementUpToDate: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
describe("按行程整理出发前清单", () => {
  it("derives only relevant groups, reservation source and verified official entry, never auto-completes", () => {
    const p = fixture(), items = deriveChecklist(p);
    expect(items.filter((i) => i.group === "transport")).toHaveLength(2);
    expect(items.filter((i) => i.group === "accommodation")).toHaveLength(1);
    expect(items.filter((i) => i.group === "reservation")).toHaveLength(1);
    expect(items.filter((i) => i.group === "essentials")).toHaveLength(2);
    expect(items.every((i) => !i.completed && i.completedAt === null)).toBe(true);
    expect(items.find((i) => i.group === "reservation")?.officialUrl).toContain("https://www.hnmuseum.com/");
    expect(parseChecklistItems(JSON.stringify(items))).toEqual(items);
  });
  it("keeps stable IDs and progress even when a regenerated equivalent plan changes model IDs", () => {
    const p = fixture(), before = deriveChecklist(p); before[0].completed = true; before[0].completedAt = new Date().toISOString();
    const same = structuredClone(p); same.events.forEach((e) => e.id = `new-${e.id}`);
    const after = mergeChecklist(before, same);
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(after[0].completedAt).toBe(before[0].completedAt);
    expect(mergeChecklist(after, same)).toEqual(after);
  });
  it("invalidates changed arrangements, retains removed records and never resurrects deleted items", () => {
    const p = fixture(), before = deriveChecklist(p), reservation = before.find((i) => i.group === "reservation")!;
    reservation.completed = true; reservation.completedAt = new Date().toISOString(); before.find((i) => i.id === "essential:phone")!.deleted = true;
    p.events.find((e) => e.id === "d1-activity")!.startTime = "10:30";
    const changed = mergeChecklist(before, p).find((i) => i.id === reservation.id)!;
    expect(changed.completed).toBe(false); expect(changed.changeNote).toContain("变化");
    p.events = p.events.filter((e) => e.id !== "d1-activity");
    const removed = mergeChecklist(before, p);
    expect(removed.find((i) => i.id === reservation.id)).toMatchObject({ orphaned: true, completed: true });
    expect(removed.find((i) => i.id === "essential:phone")?.deleted).toBe(true);
  });
  it("retains custom text and completion with a clear warning when its event disappears", () => {
    const p = fixture(), now = new Date().toISOString();
    let items = applyChecklistAction(deriveChecklist(p), { action: "add", id: "f8944978-703a-47d3-b394-dadfb4b4f687", fields: { title: "带相机", group: "essentials", note: "备用电池", date: p.events[0].date, eventId: p.events[0].id } }, p, now);
    const custom = items.at(-1)!;
    items = applyChecklistAction(items, { action: "complete", id: custom.id, completed: true }, p, now);
    p.events = p.events.filter((e) => e.id !== custom.eventId);
    expect(mergeChecklist(items, p).find((i) => i.custom)).toMatchObject({ title: "带相机", note: "备用电池", completedAt: now, orphaned: false, changeNote: expect.stringContaining("自建事项和完成记录已保留") });
  });
  it("requires reconfirmation when reservation notes change without moving the activity", () => {
    const p = fixture(), items = deriveChecklist(p), reservation = items.find((i) => i.id === "reservation:d1-activity")!;
    reservation.completed = true; reservation.completedAt = new Date().toISOString();
    p.events.find((e) => e.id === "d1-activity")!.note = "预约规则已变更，请重新确认同行名额";
    expect(mergeChecklist(items, p).find((i) => i.id === reservation.id)).toMatchObject({ completed: false, completedAt: null, changeNote: expect.stringContaining("变化") });
  });
  it("deduplicates equivalent reservation notes without trusting duplicate model note IDs", () => {
    const p = fixture();
    p.pendingItems = ["场馆甲预约", "场馆乙预约", "场馆甲预约"].map((title) => ({ id: "duplicate-model-id", title, category: "reservation", reason: "具体场馆未定", requiredBefore: null }));
    const notes = deriveChecklist(p).filter((i) => i.id.startsWith("reservation-note:"));
    expect(notes).toHaveLength(2); expect(new Set(notes.map((i) => i.id)).size).toBe(2);
    expect(parseChecklistItems(JSON.stringify(notes))).toEqual(notes);
  });
  it("validates dates, association, strict authority fields and damaged storage", () => {
    const p = fixture(), fields = { title: "准备", group: "essentials", note: "", date: "2026-02-30", eventId: null };
    expect(checklistWriteSchema.safeParse({ expectedPlanVersion: 1, expectedRevision: 0, expectedBasis: "a".repeat(64), change: { action: "add", id: crypto.randomUUID(), fields } }).success).toBe(false);
    expect(checklistWriteSchema.safeParse({ expectedPlanVersion: 1, expectedRevision: 0, expectedBasis: "a".repeat(64), change: { action: "complete", id: "a", completed: true, ticketStatus: "active" } }).success).toBe(false);
    expect(() => applyChecklistAction(deriveChecklist(p), { action: "add", id: crypto.randomUUID(), fields: { ...fields, group: "essentials", date: null, eventId: "absent" } }, p, new Date().toISOString())).toThrow("不存在");
    expect(() => parseChecklistItems("{}")).toThrow("无法读取");
  });
});
