import { describe, expect, it } from "vitest";
import { buildStayRecommendations, nightsBetween, stayConditionChecks, stayInputIssues, stayInputSchema, type StayInput } from "../lib/accommodations";
import { budgetFactorsFromSnapshot, calculateBudgetSummary, costItemLineTotals, derivePlanCosts } from "../lib/budget";
import { aiPlanOutputSchema, preparePlanForStorage, validatePlan } from "../lib/plan";
import type { PlanVersionRecord } from "../lib/plan-service";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

function fixture(days = 3): PlanVersionRecord {
  const snapshot = requestFixture(days), content = preparePlanForStorage(planFixture(snapshot));
  return { id: "p", tripId: "t", versionNumber: 1, requestRevision: 1, requestSnapshot: snapshot, ...content, costs: derivePlanCosts(content.events), places: [], tickets: [], routeLegs: [], validationResults: validatePlan(content, snapshot), isCurrent: true, requirementUpToDate: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
const input = (p: PlanVersionRecord): StayInput => ({ areaId: "today", kind: "area", hotelToken: null, routeMode: "public_transit", checkIn: p.requestSnapshot.startDate!, checkOut: p.requestSnapshot.endDate!, roomCount: 3, minCents: 18050, maxCents: 22050, morningDepartureTime: "07:00", checkInFrom: "14:00", checkOutBy: "12:00", luggageStorage: "unknown", conditionNote: "", acknowledged: true });
function selectStay(p: PlanVersionRecord, morningDepartureTime = "09:00") {
  const values = input(p);
  for (const event of p.events.filter((e) => e.type === "accommodation")) event.accommodationSelection = {
    stayId: "stay", areaId: values.areaId, areaName: "住宿区域", kind: values.kind, checkIn: values.checkIn, checkOut: values.checkOut,
    roomCount: values.roomCount, nightCount: nightsBetween(values.checkIn, values.checkOut), morningDepartureTime,
    checkInFrom: values.checkInFrom, checkOutBy: values.checkOutBy, luggageStorage: values.luggageStorage, conditionNote: "", selectedAt: new Date().toISOString(),
  };
  return p;
}
describe("住宿比较与按夜计算", () => {
  it("counts leap-month and year boundaries, rejects invalid dates and zero/overlong stays", () => {
    expect(nightsBetween("2028-02-28", "2028-03-01")).toBe(2); expect(nightsBetween("2026-12-31", "2027-01-02")).toBe(2);
    const base = input(fixture());
    for (const values of [{ checkIn: "2026-02-30" }, { checkOut: base.checkIn }, { checkOut: "2029-01-01" }, { roomCount: 0 }, { minCents: null, maxCents: 100 }]) expect(stayInputSchema.safeParse({ ...base, ...values }).success).toBe(false);
  });
  it("compares three directions without inventing coordinates, prices, availability or a feasible guarantee", () => {
    const p = fixture(); p.events.find((e) => e.id === "d2-activity")!.locationName = "次日公园"; const result = buildStayRecommendations(p, "d1-hotel");
    expect(result.areas).toHaveLength(3); expect(result.areas.every((a) => a.reference === null)).toBe(true);
    expect(result.areas.map((a) => a.focus)).toEqual(expect.arrayContaining(["当天活动", "次日活动", "返程站"]));
    expect(result.areas[0].price.source).toContain("不是当地酒店报价"); expect(result.conclusion).toContain("尚不能确认");
    p.events.find((e) => e.id === "return")!.startTime = "08:00";
    expect(buildStayRecommendations(p, "d1-hotel").areas[0].id).toBe("return");
  });
  it("explicitly reports no solution under a hard budget and keeps unknown prices unknown", () => {
    const p = fixture(); p.requestSnapshot.constraints = ["总预算上限 1 元。尽量住地铁口"];
    expect(buildStayRecommendations(p, "d1-hotel").conclusion).toContain("暂无可行");
    p.costs.find((c) => c.linkedEventId === "d1-hotel")!.unitAmountCents = null;
    expect(buildStayRecommendations(p, "d1-hotel").price.minCents).toBeNull();
  });
  it("merges coincident activity areas rather than recommending the same location twice", () => {
    const p = fixture(), result = buildStayRecommendations(p, "d1-hotel");
    expect(result.areas).toHaveLength(2); expect(result.areas[0].focus).toContain("次日活动");
  });
  it("normalizes legacy whole-trip nightly costs to a per-room per-night reference", () => {
    const p = fixture(4), cost = p.costs.find((c) => c.linkedEventId === "d1-hotel")!;
    Object.assign(cost, { unit: "per_room_per_night", unitAmountCents: 20000, unitAmountMaxCents: 30000 }); delete cost.nightCount;
    expect(buildStayRecommendations(p, "d1-hotel").price).toMatchObject({ minCents: 20000, maxCents: 30000 });
  });
  it("calculates explicit three rooms for two nights once each, independent of whole-trip traveler count", () => {
    const p = fixture(), costs = p.costs.filter((c) => c.category === "accommodation").map((c) => ({ ...c, unit: "per_room_per_night" as const, unitAmountCents: 18050, unitAmountMaxCents: 22050, nightCount: 1, roomCount: 3 }));
    expect(costItemLineTotals(costs[0], budgetFactorsFromSnapshot(p.requestSnapshot))).toMatchObject({ minCents: 54150, maxCents: 66150 });
    expect(calculateBudgetSummary(costs, { ...p.requestSnapshot, travelerCount: 9 })).toMatchObject({ totalMinCents: 108300, totalMaxCents: 132300 });
  });
  it("checks early arrival, luggage availability, late checkout and missing nightly slots", () => {
    const p = fixture(), v = input(p); p.events.find((e) => e.id === "d1-hotel")!.startTime = "11:00";
    const stays = p.events.filter((e) => e.type === "accommodation");
    expect(stayConditionChecks(stays, { ...v, luggageStorage: "unavailable" }).conflicts.join()).toContain("不可寄存");
    expect(stayConditionChecks(stays, { ...v, luggageStorage: "available" }).warnings.join()).toContain("不等于可提前进房");
    expect(stayConditionChecks(stays, { ...v, morningDepartureTime: "13:00" }).conflicts.join()).toContain("退房截止");
    p.events = p.events.filter((e) => e.id !== "d2-hotel"); expect(stayInputIssues(p, "d1-hotel", v).join()).toContain("没有唯一");
  });
  it("checks every morning independently while keeping hotel preparation and unlocated breakfast possible", () => {
    const p = selectStay(fixture());
    expect(validatePlan(p, p.requestSnapshot, p.costs).errors).toEqual([]);
    const lastActivity = p.events.find((e) => e.id === "d3-activity")!;
    Object.assign(lastActivity, { startTime: "08:40", endTime: "08:50" });
    const errors = validatePlan(p, p.requestSnapshot, p.costs).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`${lastActivity.date} 计划09:00从住宿离店`);
  });
  it("uses plan departure rather than the hotel's noon checkout deadline and checks known outside meals", () => {
    const p = selectStay(fixture(2), "10:00");
    expect(validatePlan(p, p.requestSnapshot, p.costs).errors).toEqual([]);
    p.events.find((e) => e.id === "d2-breakfast")!.placeId = "outside-cafe";
    expect(validatePlan(p, p.requestSnapshot, p.costs).errors.join()).toContain("早餐的开始时刻08:00");
    p.events.find((e) => e.id === "d1-hotel")!.placeId = "hotel";
    p.events.find((e) => e.id === "d1-hotel")!.accommodationSelection!.kind = "hotel";
    p.events.find((e) => e.id === "d2-breakfast")!.placeId = "hotel";
    expect(validatePlan(p, p.requestSnapshot, p.costs).errors).toEqual([]);
  });
  it("rejects transport before the planned departure without relying on route coordinates", () => {
    const p = selectStay(fixture(2), "09:00");
    p.events.push({ ...p.events.find((e) => e.id === "d2-preparation")!, id: "early-transport", type: "local_transport", startTime: "06:30", endTime: "07:00", title: "前往车站" });
    expect(validatePlan(p, p.requestSnapshot, p.costs).errors.join()).toContain("前往车站的开始时刻06:30");
  });
  it("model output cannot claim confirmed accommodation details", () => {
    const p = fixture(), event = p.events.find((e) => e.id === "d1-hotel")!;
    const output = aiPlanOutputSchema.parse({ ...p, events: [{ ...event, accommodationSelection: { kind: "hotel" } }] });
    expect(output.events[0]).not.toHaveProperty("accommodationSelection");
  });
});
