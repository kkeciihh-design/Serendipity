import { describe, expect, it } from "vitest";
import { projectAdvisories, weatherTarget } from "../lib/advisory-rules";
import { deriveChecklist } from "../lib/checklist-merge";
import { preparePlanForStorage, validatePlan } from "../lib/plan";
import { derivePlanCosts } from "../lib/budget";
import type { PlanVersionRecord } from "../lib/plan-service";
import type { EvidenceFactClient } from "../lib/evidence";
import { unknownWeatherRecord } from "../lib/weather";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";
import { manualReferenceRoute } from "../lib/routes";
import { activateTicket } from "../lib/tickets";
import { ticketFixture } from "./helpers/ticket-fixtures";
function fixture(): PlanVersionRecord {
  const snapshot = requestFixture(2, { startDate: "2026-10-19", endDate: "2026-10-20" }), content = preparePlanForStorage(planFixture(snapshot));
  content.events.find((e) => e.id === "d1-activity")!.title = content.events.find((e) => e.id === "d1-activity")!.locationName = "湖南博物院";
  content.events.find((e) => e.id === "d2-activity")!.title = content.events.find((e) => e.id === "d2-activity")!.locationName = "橘子洲";
  return { id: "p", tripId: "t", versionNumber: 1, requestRevision: 1, requestSnapshot: snapshot, ...content, costs: derivePlanCosts(content.events), places: [], routeLegs: [], tickets: [], validationResults: validatePlan(content, snapshot), isCurrent: true, requirementUpToDate: true, createdAt: "", updatedAt: "" };
}
const run = (plan = fixture(), overrides: Partial<Parameters<typeof projectAdvisories>[0]> = {}) => projectAdvisories({ plan, checklist: deriveChecklist(plan), facts: [], weather: [], previous: [], now: new Date("2026-10-16T08:00:00Z"), ...overrides });
describe("相关活动提醒", () => {
  it.each(["opening_hours", "reservation"] as const)("keeps reminders readable when the first %s source lookup fails with empty metadata", (field) => {
    const p = fixture();
    const fact: EvidenceFactClient = { id: "failed-source", planVersionId: p.id, targetType: "event", targetId: "d1-activity", field,
      status: "unverified", effectiveStatus: "stale", evaluationVersion: 0, sourceTitle: "", sourceUrl: "", sourcePublisher: "",
      sourcePublishedAt: null, sourceDateStatus: "not_read", extractedValue: "", searchProvider: "duckduckgo", searchQuery: "museum",
      retrievedAt: "2026-10-16T08:00:00Z", applicableFrom: null, applicableUntil: null, lastRefreshAt: "2026-10-16T08:00:00Z",
      lastRefreshStatus: "failed", lastRefreshError: "搜索服务要求人机验证", contentQuote: "", conflictReason: null };
    const item = run(p, { facts: [fact] }).find((i) => i.eventId === fact.targetId && i.category === field)!;
    expect(item).toMatchObject({ validity: "stale", acknowledged: false, sourceUrl: null });
    expect(item.sourceLabel.trim()).not.toBe("");
    expect(run(p, { facts: [fact] })).toEqual(run(p, { facts: [fact] }));
  });
  it("ties reminders to actual events/checklist, does not repeat venue templates on generic meals/rest", () => {
    const p = fixture(), items = run(p); expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    expect(items.every((i) => p.events.some((e) => e.id === i.eventId))).toBe(true);
    expect(items.some((i) => i.eventId === "d1-breakfast" || i.eventId === "d1-rest")).toBe(false);
    expect(items.find((i) => i.id === "reservation:d1-activity")?.checklistItemId).toBe("reservation:d1-activity");
    expect(items.find((i) => i.id === "opening:d1-activity")).toMatchObject({ validity: "unknown", title: "开放安排需复核" });
  });
  it("completed reservations cease reminding without treating an acknowledged item as a booking", () => {
    const p = fixture(), list = deriveChecklist(p); list.find((i) => i.id === "reservation:d1-activity")!.completed = true;
    expect(run(p, { checklist: list }).some((i) => i.id === "reservation:d1-activity")).toBe(false);
    const old = run(p); old[0].acknowledged = true; old[0].acknowledgedAt = "2026-10-16T08:00:00Z";
    expect(run(p, { previous: old }).find((i) => i.id === old[0].id)?.status).toBe("known");
    p.events.find((e) => e.id === old[0].eventId)!.startTime = "09:30";
    expect(run(p, { previous: old }).find((i) => i.id === old[0].id)?.acknowledged).toBe(false);
  });
  it("rain is specific to the outdoor activity, disappears when stale, failed or beyond range", () => {
    const p = fixture(), e = p.events.find((e) => e.id === "d2-activity")!, target = weatherTarget(p, e)!;
    const rain = { ...unknownWeatherRecord({ ...target, status: "fresh" }), retrievedAt: "2026-10-16T08:00:00Z", precipitationProbabilityMax: 80, precipitationSumMm: 12 };
    expect(run(p, { weather: [rain] }).filter((i) => i.category === "weather").map((i) => i.eventId)).toEqual([e.id]);
    for (const status of ["failed", "out_of_range", "unknown"] as const) expect(run(p, { weather: [{ ...rain, status }] }).some((i) => i.category === "weather")).toBe(false);
    expect(run(p, { weather: [rain], now: new Date("2026-10-16T09:00:00Z") }).some((i) => i.category === "weather")).toBe(false);
  });
  it("does not borrow forecasts from a replaced location or an indoor event", () => {
    const p = fixture(), e = p.events.find((e) => e.id === "d2-activity")!, target = weatherTarget(p, e)!;
    const rain = { ...unknownWeatherRecord({ ...target, status: "fresh" }), retrievedAt: "2026-10-16T08:00:00Z", precipitationSumMm: 12 };
    e.title = e.locationName = "湖南博物院";
    expect(run(p, { weather: [rain] }).some((i) => i.category === "weather")).toBe(false);
  });
  it("verified closure stays a required action even after acknowledgement; stale source is downgraded", () => {
    const p = fixture(), fact: EvidenceFactClient = { id: "f", planVersionId: "p", targetType: "event", targetId: "d1-activity", field: "opening_hours", status: "verified", effectiveStatus: "verified", evaluationVersion: 1, sourceTitle: "合成官方闭馆通知", sourceUrl: "https://example.com/closure", sourcePublisher: "合成", sourcePublishedAt: null, sourceDateStatus: "applicable", extractedValue: "闭馆", searchProvider: "test", searchQuery: "", retrievedAt: "2026-10-16T08:00:00Z", applicableFrom: "2026-10-18T16:00:00Z", applicableUntil: "2026-10-19T15:59:59Z", lastRefreshAt: null, lastRefreshStatus: null, lastRefreshError: null, contentQuote: "本日闭馆", conflictReason: null };
    const items = run(p, { facts: [fact] }), closure = items.find((i) => i.category === "opening_hours")!;
    expect(closure).toMatchObject({ severity: "action", validity: "valid" }); closure.acknowledged = true;
    expect(run(p, { facts: [fact], previous: items }).find((i) => i.id === closure.id)).toMatchObject({ severity: "action", acknowledged: true });
    expect(run(p, { facts: [{ ...fact, lastRefreshStatus: "failed" }], previous: items }).find((i) => i.id === closure.id)).toMatchObject({ validity: "stale", acknowledged: false });
    expect(run(p, { facts: [{ ...fact, status: "conflict", conflictReason: "本次到访日闭馆", lastRefreshStatus: "failed" }], previous: items }).find((i) => i.id === closure.id)).toMatchObject({ validity: "stale", acknowledged: false });
    expect(run(p, { facts: [{ ...fact, status: "conflict", conflictReason: "本次到访日闭馆" }], now: new Date("2026-10-20T08:00:00Z") }).find((i) => i.id === closure.id)).toMatchObject({ validity: "stale" });
  });
  it("early check-in plus unknown luggage is relevant, known normal check-in removes both", () => {
    const p = fixture(), e = p.events.find((e) => e.type === "accommodation")!; e.startTime = "10:00";
    e.accommodationSelection = { stayId: "stay", areaId: "area", areaName: "市中心", kind: "hotel", checkIn: e.date, checkOut: "2026-10-20", roomCount: 1, nightCount: 1, morningDepartureTime: "08:00", checkInFrom: "14:00", checkOutBy: "12:00", luggageStorage: "unknown", conditionNote: "", selectedAt: "2026-10-16T08:00:00Z" };
    expect(run(p).filter((i) => i.category === "accommodation")).toHaveLength(2);
    e.startTime = "15:00"; expect(run(p).filter((i) => i.category === "accommodation")).toHaveLength(0);
  });
  it("removed events shed their reminders and unrelated pending notes do not generate reminders", () => {
    const p = fixture(), previous = run(p); p.events = p.events.filter((e) => ["rest", "preparation", "meal"].includes(e.type));
    p.pendingItems.push({ id: "unused", category: "reservation", title: "未去景点的预约", reason: "不关联行程", requiredBefore: null });
    expect(run(p, { previous })).toHaveLength(0);
  });
  it("names the actual restaurant for unknown queues without inventing waiting minutes", () => {
    const p = fixture(), e = p.events.find((e) => e.id === "d1-lunch")!; e.locationName = "火宫殿坡子街总店";
    const queue = run(p).filter((i) => i.category === "queue"); expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ eventId: e.id, validity: "unknown", title: "本餐排队时长未知" }); expect(queue[0].reason).not.toContain("分钟");
  });
  it("links no-service routes to both activities and ignores inactive ticket baggage notes", () => {
    const p = fixture(); p.routeLegs = [manualReferenceRoute({ tripId: p.tripId, date: p.requestSnapshot.startDate!, edit: { fromEventId: "d1-breakfast", toEventId: "d1-activity", departureTime: "09:00", manualReference: { availability: "no_service", durationMinutes: null, fareCents: null, instructions: "合成公交此时无运营", sourceName: "合成人工查询", sourceUrl: null, checkedAt: "2026-10-16T08:00:00Z", acknowledged: true } } })];
    p.tickets = [activateTicket(ticketFixture(p.requestSnapshot.startDate!, { baggageNote: "需核对特殊行李规则" }))];
    const items = run(p).filter((i) => i.category === "transport"); expect(items).toHaveLength(2);
    expect(items.find((i) => i.title === "关联交通记录无运营")?.eventIds).toEqual(["d1-breakfast", "d1-activity"]);
    p.tickets[0].status = "cancelled"; expect(run(p).filter((i) => i.category === "transport")).toHaveLength(1);
    p.routeLegs = []; expect(run(p).filter((i) => i.category === "transport")).toHaveLength(0);
  });
});
