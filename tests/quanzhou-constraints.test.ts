import { describe, expect, it } from "vitest";
import { emptyRequestSnapshot, resolveRelativeDates } from "../lib/trip-request";
import { exactTransportTimeCopy, getTripHardTimeConstraints, preserveExplicitTransportTimes, validateTripHardTimes } from "../lib/trip-hard-constraints";
import { normalizeGeneratedQuality, validateArrivalLunch, validateVisitHours } from "../lib/planning-quality";
import { deriveGeneratedPlanCosts } from "../lib/generated-costs";
import { calculateBudgetSummary, validatePlanCosts } from "../lib/budget";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

const now = new Date("2026-10-19T08:00:00+08:00");
const request = requestFixture(3, { destination: "福建泉州", startDate: "2026-11-07", endDate: "2026-11-09", budgetAmountCents: 350000 });

describe("Quanzhou date and hard constraints regression", () => {
  it.each([
    ["下个月周末去泉州玩3天", "2026-11-07", "2026-11-09"],
    ["下下个月周末去泉州玩3天", "2026-12-05", "2026-12-07"],
    ["11月周末去泉州玩3天", "2026-11-07", "2026-11-09"],
    ["2027年1月周末玩2天", "2027-01-02", "2027-01-03"],
    ["周末玩3天", "2026-10-24", "2026-10-26"],
  ])("anchors %s", (text, startDate, endDate) => {
    expect(resolveRelativeDates(text, emptyRequestSnapshot(), now)).toMatchObject({ startDate, endDate });
  });
  it("rolls relative months across year and respects an explicit calendar day", () => {
    expect(resolveRelativeDates("下个月周末玩3天", emptyRequestSnapshot(), new Date("2026-12-20T00:00:00Z")).startDate).toBe("2027-01-02");
    expect(resolveRelativeDates("下个月11月14日周末玩3天", emptyRequestSnapshot(), now).startDate).toBe("2026-11-14");
  });
  it("persists exact 16:00 even when the model softened it, and validates edits", () => {
    const snapshot = preserveExplicitTransportTimes({ ...request, constraints: ["第3天16:00左右返程"] }, "第 3 天下午 16:00 的高铁回深圳");
    expect(getTripHardTimeConstraints(snapshot)).toContainEqual({ kind: "return_departure", date: "2026-11-09", time: "16:00", label: "16:00 返程发车 · 硬时间" });
    expect(exactTransportTimeCopy("请买16:00左右的返程票", snapshot)).toBe("请买16:00的返程票");
    const plan = planFixture(snapshot);
    expect(validateTripHardTimes(plan.events, snapshot).length).toBeGreaterThan(0);
    plan.events.find((event) => event.type === "return_transport")!.startTime = "16:00";
    expect(validateTripHardTimes(plan.events, snapshot)).toEqual([]);
    expect(getTripHardTimeConstraints(request, "博物馆18:00闭馆，16:00左右返程")).toEqual([]);
  });
  it("distinguishes an explicit outbound arrival", () => {
    expect(getTripHardTimeConstraints(request, "第一天12:30到达泉州")).toMatchObject([{ kind: "outbound_arrival", time: "12:30", date: "2026-11-07" }]);
  });
  it("binds multiple times to their own actions and never makes return arrival a departure", () => {
    expect(getTripHardTimeConstraints(request, "第一天09:00出发12:30到达泉州，第三天16:00返程高铁，20:30回到深圳").map(({ kind, time }) => ({ kind, time }))).toEqual([
      { kind: "outbound_departure", time: "09:00" }, { kind: "outbound_arrival", time: "12:30" }, { kind: "return_departure", time: "16:00" },
    ]);
    expect(getTripHardTimeConstraints(request, "第3天15:00到达泉州站16:00高铁返程").map(({ kind, time }) => ({ kind, time }))).toEqual([
      { kind: "return_departure", time: "16:00" },
    ]);
    expect(getTripHardTimeConstraints(request, "去程上午9点半发车，中午12:30到达泉州").map(({ time }) => time)).toEqual(["09:30", "12:30"]);
    expect(getTripHardTimeConstraints(request, "第3天16:00返程，18:00博物馆闭馆").map(({ time }) => time)).toEqual(["16:00"]);
  });
  it("retains canonical dates and prefers original exact facts over inconsistent AI paraphrases", () => {
    const snapshot = preserveExplicitTransportTimes({ ...request, constraints: ["最后一天17:00返程", "第2天16:00返程"] }, "第2天16:00高铁返程");
    expect(getTripHardTimeConstraints(snapshot)).toEqual([{ kind: "return_departure", date: "2026-11-08", time: "16:00", label: "16:00 返程发车 · 硬时间" }]);
    expect(getTripHardTimeConstraints(request, "2026-11-08 16:00返程高铁")[0]?.date).toBe("2026-11-08");
    expect(getTripHardTimeConstraints(request, "预计16:00返程，16:00前到达泉州站，第一天12:00到达酒店，下午17:00出发去开元寺")).toEqual([]);
  });
});

describe("generated timing and narrative costs", () => {
  it("protects Kaiyuan closing hours and flags a late lunch after noon arrival", () => {
    const plan = planFixture(request);
    Object.assign(plan.events.find((event) => event.id === "d1-activity")!, { title: "开元寺参观", locationName: "泉州开元寺", startTime: "16:30", endTime: "18:30" });
    expect(validateVisitHours(plan.events, request).length).toBe(1);
    const normalized = normalizeGeneratedQuality(plan, request);
    expect(normalized.events.find((event) => event.id === "d1-activity")?.endTime).toBe("18:00");
    expect(validateVisitHours(normalized.events, request)).toEqual([]);
    plan.events.find((event) => event.id === "departure")!.endTime = "12:30";
    plan.events.find((event) => event.id === "d1-lunch")!.startTime = "15:30";
    expect(validateArrivalLunch(plan.events).length).toBe(1);
    expect(normalizeGeneratedQuality(plan, request).events.find((event) => event.id === "departure")?.note).toContain("酒店前台");
  });
  it("retains two nightly ranges and a stated arrival taxi without duplicating a dedicated transfer", () => {
    const plan = planFixture(request);
    const hotels = plan.events.filter((event) => event.type === "accommodation");
    hotels.forEach((event) => { event.note = "西街隔音客房，320-450元/晚，推荐1间。"; event.costDraftCents = 32000; });
    const departure = plan.events.find((event) => event.id === "departure")!;
    departure.note = "高铁车票254元/人。泉州站打车至西街约30元。";
    const costs = deriveGeneratedPlanCosts(plan.events, request);
    expect(calculateBudgetSummary(costs, request).categories.find((item) => item.category === "accommodation")).toMatchObject({ minTotalCents: 64000, maxTotalCents: 90000 });
    expect(costs.find((cost) => cost.id === "cost-transfer-departure")).toMatchObject({ unitAmountCents: 3000, category: "local_transport" });
    plan.events.push({ ...departure, id: "arrival-transfer", type: "local_transport", title: "泉州站到西街", startTime: "08:00", endTime: "08:30", note: "打车约30-45元", costDraftCents: 3000 });
    const withTransfer = deriveGeneratedPlanCosts(plan.events, request);
    expect(withTransfer.some((cost) => cost.id === "cost-transfer-departure")).toBe(false);
    expect(withTransfer.find((cost) => cost.linkedEventId === "arrival-transfer")).toMatchObject({ unitAmountCents: 3000, unitAmountMaxCents: 4500 });
  });
  it("uses room rates instead of per-person breakfast or hostel rates, and preserves explicit shared-car units", () => {
    const events = planFixture(request).events;
    const hotel = events.find((event) => event.type === "accommodation")!;
    hotel.note = "人均160元/晚，双人房320-450元/房/晚，早餐35元/人";
    const transfer = { ...hotel, id: "shared-transfer", type: "local_transport" as const, title: "泉州站到西街", note: "接驳车约15元/人", costDraftCents: 3000 };
    const costs = deriveGeneratedPlanCosts([...events, transfer], request);
    expect(costs.find((cost) => cost.linkedEventId === hotel.id)).toMatchObject({ unit: "per_room_per_night", unitAmountCents: 32000, unitAmountMaxCents: 45000 });
    expect(costs.find((cost) => cost.linkedEventId === transfer.id)).toMatchObject({ unit: "per_person", unitAmountCents: 1500 });
  });
  it("does not use a meal fare as taxi cost or suppress a station pickup because a later unrelated trip exists", () => {
    const events = planFixture(request).events;
    const departure = events.find((event) => event.id === "departure")!;
    departure.note = "票价不含当地接驳。泉州站打车至西街约30元。";
    const unrelated = { ...departure, id: "unrelated-taxi", type: "local_transport" as const, title: "酒店打车去开元寺", locationName: "开元寺",
      startTime: "09:00", endTime: "09:30", costDraftCents: 1800, note: "打车到开元寺，之后午餐人均35元。" };
    const costs = deriveGeneratedPlanCosts([...events, unrelated], request);
    expect(costs.find((cost) => cost.id === "cost-transfer-departure")).toMatchObject({ unitAmountCents: 3000 });
    expect(costs.find((cost) => cost.linkedEventId === unrelated.id)).toMatchObject({ unitAmountCents: 1800 });
    departure.note = "高铁票价已包含当地接驳，泉州站打车至西街约30元。";
    expect(deriveGeneratedPlanCosts(events, request).some((cost) => cost.id === "cost-transfer-departure")).toBe(false);
  });
  it("includes the actual AI lunch-note station transfer while retaining the meal amount and avoiding an existing matching leg", () => {
    const events = planFixture(request).events;
    const lunch = events.find((event) => event.id === "d1-lunch")!;
    lunch.costDraftCents = 6000;
    lunch.note = "从泉州站打车或公交到西街钟楼附近约25—35分钟，车费约25—35元。面线糊是泉州早餐/午餐经典，建议加醋肉、大肠、卤蛋、油条，人均约20—30元，2人合计约60元。吃完可直接步行进入西街游览，避免拖到14:30后午餐。";
    const costs = deriveGeneratedPlanCosts(events, request);
    expect(costs.find((cost) => cost.id === "cost-d1-lunch")).toMatchObject({ unitAmountCents: 6000, category: "meal" });
    const transferCost = costs.find((cost) => cost.id === "cost-transfer-d1-lunch")!;
    expect(transferCost).toMatchObject({ category: "local_transport", unit: "one_time", unitAmountCents: 2500, unitAmountMaxCents: 3500 });
    expect(validatePlanCosts(costs, events)).toEqual([]);
    expect(validatePlanCosts([...costs, { ...transferCost }], events).join()).toContain("重复");
    expect(validatePlanCosts(costs.map((cost) => cost.id === transferCost.id ? { ...cost, category: "meal" } : cost), events).join()).toContain("重复关联");
    expect(validatePlanCosts(costs.map((cost) => cost.id === transferCost.id ? { ...cost, id: "cost-transfer-not-the-event" } : cost), events).join()).toContain("重复关联");
    const local = { ...lunch, id: "dedicated-pickup", type: "local_transport" as const, title: "泉州站打车至西街钟楼", locationName: "西街钟楼",
      startTime: "11:50", endTime: "12:25", note: "车费约25—35元", costDraftCents: 2500 };
    const deduplicated = deriveGeneratedPlanCosts([...events, local], request);
    expect(deduplicated.some((cost) => cost.id === transferCost.id)).toBe(false);
    expect(deduplicated.find((cost) => cost.linkedEventId === local.id)).toMatchObject({ unitAmountCents: 2500, unitAmountMaxCents: 3500 });
  });
  it.each(["activity", "accommodation"] as const)("adds a separate %s access cost without leaking room pricing metadata or overriding confirmed facts", (type) => {
    const event = { ...planFixture(request).events[0], id: `narrative-${type}`, type, startTime: "13:30", endTime: "14:30", costDraftCents: 32000,
      note: "从泉州站打车至西街钟楼约30元。住宿参考320—450元/房/晚。" };
    const costs = deriveGeneratedPlanCosts([event], request);
    const transfer = costs.find((cost) => cost.id === `cost-transfer-${event.id}`)!;
    expect(transfer).toMatchObject({ category: "local_transport", unitAmountCents: 3000 });
    expect(transfer.roomCount).toBeUndefined(); expect(transfer.nightCount).toBeUndefined();
    expect(validatePlanCosts(costs, [event])).toEqual([]);
    const confirmed = deriveGeneratedPlanCosts([{ ...event, costStatus: "user_confirmed", costDraftCents: 38000 }], request);
    expect(confirmed).toHaveLength(1); expect(confirmed[0].unitAmountCents).toBe(38000);
  });
  it("counts a single station pickup mentioned by both arrival and lunch only once", () => {
    const events = planFixture(request).events;
    const departure = events.find((event) => event.id === "departure")!, lunch = events.find((event) => event.id === "d1-lunch")!;
    departure.endTime = "12:00";
    departure.note = "到达后从泉州站打车至西街钟楼约30元。";
    lunch.note = "从泉州站打车到西街钟楼附近约30元。午餐人均30元。";
    expect(deriveGeneratedPlanCosts(events, request).filter((cost) => cost.id.startsWith("cost-transfer-"))).toHaveLength(1);
  });
  it.each([
    ["打车从蟳埔村至泉州海外交通史博物馆", "雨天改为室内参观，从蟳埔村打车或网约车至泉州海外交通史博物馆，约25—35分钟，2人参考30—45元。博物馆位于泉州丰泽区，具体开放时间、是否需预约及入馆要求以馆方当日公告为准。", 3000, 4500],
    ["从泉州海外交通史博物馆返回西街钟楼", "从泉州海外交通史博物馆返回西街钟楼住宿片区，约15—25分钟，2人参考20—35元。雨天建议直接打车或网约车回老城，避免多次换乘。回到酒店后可稍作休息洗漱，再前往西街钟楼附近晚餐。", 2000, 3500],
  ])("retains the real rain-replan group fare range across comma-separated route and duration: %s", (title, note, min, max) => {
    const event = { ...planFixture(request).events[0], id: "rain-transfer", type: "local_transport" as const, title, note, costDraftCents: 3500 };
    expect(deriveGeneratedPlanCosts([event], request)[0]).toMatchObject({ unit: "one_time", unitAmountCents: min, unitAmountMaxCents: max });
  });
  it("does not take later meal prices as a local transport fare and can find transport after a meal price", () => {
    const event = { ...planFixture(request).events[0], id: "food-not-taxi", type: "local_transport" as const, title: "打车前往西街", costDraftCents: 1800,
      note: "从博物馆打车返回西街，约20分钟，晚餐2人参考80—120元。" };
    expect(deriveGeneratedPlanCosts([event], request)[0]).toMatchObject({ unitAmountCents: 1800, unitAmountMaxCents: null });
    event.note = "晚餐2人参考80—120元，之后打车返回酒店，约20分钟，2人参考20—30元。";
    expect(deriveGeneratedPlanCosts([event], request)[0]).toMatchObject({ unit: "one_time", unitAmountCents: 2000, unitAmountMaxCents: 3000 });
    event.note = "到西街后吃面线糊，人均参考20—30元。雨天建议打车。";
    expect(deriveGeneratedPlanCosts([event], request)[0]).toMatchObject({ unitAmountCents: 1800, unitAmountMaxCents: null });
  });
});
