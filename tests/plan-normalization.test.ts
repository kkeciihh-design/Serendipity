import { describe, expect, it } from "vitest";
import { normalizePlanChineseCopy, normalizePlanOutput, parseAIPlanOutput, validateGeneratedPlan, validatePlan } from "../lib/plan";
import { derivePlanCosts } from "../lib/budget";
import { planFixture, requestFixture } from "./helpers/plan-fixtures";

const snapshot = requestFixture(2, { destination: "九寨沟", travelerCount: 2 });
const visit = {
  day: "第 1 天", date: snapshot.startDate, time: "8:30至11：45", category: "景区游览",
  name: "五花海木栈道 → 珍珠滩瀑布", location: "九寨沟五花海",
  cost: "¥190", coordinates: [103.8782, 33.1618],
  route: ["沟口检票入园", "观光车至五花海站", "沿环湖木栈道步行至珍珠滩瀑布"],
  booking: "提前通过景区官方公众号实名预约门票与观光车套票。",
  tips: "穿防滑步行鞋，备防雨外套和饮水；遵守景区当日开放动线。",
};

describe("universal plan field normalization", () => {
  it.each([
    (json: string) => `<think>先分析人数，{这不是行程}</think>\n好的，这是攻略：\n\`\`\`json\n${json}\n\`\`\`\n祝旅途愉快！`,
    (json: string) => `Here is your itinerary:\n${json}\nHave a nice trip.`,
    (json: string) => JSON.stringify(json),
  ])("extracts complete plans and preserves real itinerary details across model wrappers", (wrap) => {
    const plan = normalizePlanOutput(parseAIPlanOutput(wrap(JSON.stringify({ events: [visit], pendingItems: null })), snapshot));
    expect(plan.events[0]).toMatchObject({
      id: "ai-event-1", dayNumber: 1, date: snapshot.startDate, type: "activity", startTime: "08:30", endTime: "11:45",
      locationName: "九寨沟五花海", costDraftCents: 19000, costStatus: "estimated", latitude: 33.1618, longitude: 103.8782,
      suggestedDurationSeconds: 11700, status: "suggested", locked: false,
    });
    expect(plan.events[0].note).toContain("沿环湖木栈道步行至珍珠滩瀑布");
    expect(plan.events[0].note).toContain("官方公众号实名预约");
    expect(plan.pendingItems).toEqual([]);
  });

  it("flattens day arrays, derives missing dates and normalizes separate price and time fields", () => {
    const plan = parseAIPlanOutput(JSON.stringify([
      { day: "1", activities: [{ ...visit, date: null, day: null, dayNumber: null, time: null, start: "下午1点", durationMinutes: "90", category: "打卡", cost: { amount: 45.5, unit: "元" } }] },
      { day: "2", activities: [{ category: "早饭", name: "早餐", place: "沟口彭丰村", dishes: ["青稞饼", "酥油茶"], startTime: "7:30", endTime: "8:10", pricePerPerson: 25, coordinateSystem: null }] },
    ]), snapshot);
    expect(plan.events[0]).toMatchObject({ date: snapshot.startDate, dayNumber: 1, startTime: "13:00", endTime: "14:30", costDraftCents: 4550 });
    expect(plan.events[1]).toMatchObject({ date: snapshot.endDate, dayNumber: 2, type: "meal", costDraftCents: 5000, costStatus: "estimated" });
    expect(plan.events[1].title).toContain("青稞饼");
  });

  it.each([
    ["美食", "meal"], ["用餐", "meal"], ["早饭", "meal"], ["交通", "local_transport"],
    ["乘车", "local_transport"], ["高铁", "local_transport"], ["游览", "activity"], ["景区", "activity"], ["打卡", "activity"],
  ])("maps %s without rejecting a full response", (input, output) => {
    const plan = parseAIPlanOutput(JSON.stringify({ events: [{ ...visit, category: input }] }), snapshot);
    expect(plan.events[0].type).toBe(output);
  });

  it("preserves integer cents, converts explicit yuan in cents fields, and retains long notes", () => {
    const note = "从沟口乘车至五花海，沿环湖木栈道步行至珍珠滩瀑布；提前预约官方门票与观光车。".repeat(20);
    const events = [
      { ...visit, costDraftCents: 12345, note, costStatus: "estimated" },
      { ...visit, costCents: "70元", costStatus: null, note: null, lat: "33.1618", lng: "103.8782" },
      { ...visit, cost: { amount: 350, unit: "元" }, costBasis: "per_room", coordinateSystem: "gcj02" },
      { ...visit, costDraftCents: 70, costUnit: "元" },
    ];
    const plan = parseAIPlanOutput(JSON.stringify({ events }), snapshot);
    expect(plan.events.map((event) => event.costDraftCents)).toEqual([12345, 7000, 35000, 7000]);
    expect(plan.events[0].note).toContain(note);
    expect(plan.events[2].coordinateSystem).toBe("GCJ-02");
  });

  it("merges additional descriptions and tips without replacing the model's note", () => {
    const plan = parseAIPlanOutput(JSON.stringify({ events: [{ ...visit, note: "穿防滑鞋", description: "沿临水木栈道游览三个观景台", details: "在末站乘观光车返回沟口" }] }), snapshot);
    expect(plan.events[0].note).toContain("穿防滑鞋");
    expect(plan.events[0].note).toContain("沿临水木栈道游览三个观景台");
    expect(plan.events[0].note).toContain("在末站乘观光车返回沟口");
  });

  it("keeps user authority separate while preserving the model's estimates and coordinates", () => {
    const plan = normalizePlanOutput(parseAIPlanOutput(JSON.stringify({ events: [{ ...visit, status: "confirmed", locked: true, costStatus: "user_confirmed", paymentStatus: "paid", placeId: "invented-place" }] }), snapshot));
    expect(plan.events[0]).toMatchObject({ status: "suggested", locked: false, costDraftCents: 19000, latitude: 33.1618 });
    expect(plan.events[0].placeId).toBeUndefined();
    expect(plan.events[0]).not.toHaveProperty("paymentStatus");
  });

  it("uses the selected money field once and applies only explicit per-person or per-room units", () => {
    const amounts = [
      { costDraftCents: 14000, costPerPerson: 70 },
      { costDraftCents: 14000, costPerPerson: null },
      { cost: "人均70元" },
      { cost: "70元/人" },
      { cost: { amount: 70, unit: "元", pricingUnit: "per_person" } },
      { cost: { amount: 300, unit: "元", pricingUnit: "per_room" } },
    ];
    const plan = parseAIPlanOutput(JSON.stringify({ events: amounts.map((amount) => ({ ...visit, ...amount })) }), { ...snapshot, travelerCount: 4 });
    expect(plan.events.map((event) => event.costDraftCents)).toEqual([14000, 14000, 28000, 28000, 28000, 60000]);
  });

  it.each([["2小时", "10:30"], ["1.5 hours", "10:00"], ["1小时30分钟", "10:00"]])("understands duration %s and transport direction from explicit titles", (duration, endTime) => {
    const plan = parseAIPlanOutput(JSON.stringify({ events: [{
      ...visit, category: "高铁", name: "去程 · 成都东站乘动车至黄龙九寨站", time: null, startTime: "8:30", duration,
    }, {
      ...visit, category: "乘车", name: "返程 · 黄龙九寨站至成都东站",
    }] }), snapshot);
    expect(plan.events[0]).toMatchObject({ type: "departure_transport", startTime: "08:30", endTime });
    expect(plan.events[1].type).toBe("return_transport");
  });

  it("accepts a complete plan without manufacturing repetitive pending items", () => {
    const full = { ...planFixture(snapshot), pendingItems: [] };
    expect(validatePlan(normalizePlanOutput(parseAIPlanOutput(JSON.stringify(full), snapshot)), snapshot).errors).toEqual([]);
  });

  it("still reports missing core schedule data instead of inventing an itinerary", () => {
    expect(() => parseAIPlanOutput(JSON.stringify({ events: [{ category: "游览" }] }), snapshot)).toThrow();
    expect(() => parseAIPlanOutput('{"events":[{"title":"unfinished"')).toThrow(/截断/);
  });

  it("ignores unrelated JSON examples and uses the final complete itinerary", () => {
    const final = JSON.stringify({ events: [visit] });
    const plan = parseAIPlanOutput(`示例字段：{"example":true}\n实际行程：${final}`, snapshot);
    expect(plan.events[0].title).toBe(visit.name);
    expect(() => parseAIPlanOutput(`完整例子：${final}\n实际行程：{"events":[{"title":"未完成"`, snapshot)).toThrow(/截断|完整/);
  });

  it("corrects generated 身fen证 copy in prose without rewriting identifiers or input", () => {
    const raw = { events: [{ ...visit, id: "身fen证-event", name: "携带身fen证入园", note: "核对身 FEN 证与预约凭证", location: "身fen证核验入口" }],
      pendingItems: [{ id: "身fen证-pending", title: "备好身fen证", reason: "身fen证需随身携带" }] };
    const plan = parseAIPlanOutput(JSON.stringify(raw), snapshot);
    expect(plan.events[0]).toMatchObject({ id: "身fen证-event", title: "携带身份证入园", note: expect.stringContaining("核对身份证与预约凭证"), locationName: "身份证核验入口" });
    expect(plan.pendingItems[0]).toMatchObject({ id: "身fen证-pending", title: "备好身份证", reason: "身份证需随身携带" });
    expect(raw.events[0].name).toBe("携带身fen证入园");
  });

  it("repairs legacy suggestions in a copy while preserving locked and confirmed events", () => {
    const plan = planFixture(snapshot);
    plan.events[0].note = "带好身fen证";
    plan.events[1].note = "用户锁定原文身fen证";
    plan.events[1].locked = true;
    plan.events[2].note = "用户确认原文身fen证";
    plan.events[2].status = "confirmed";
    const before = structuredClone(plan);
    const repaired = normalizePlanChineseCopy(plan);
    expect(repaired.events[0].note).toBe("带好身份证");
    expect(repaired.events[1]).toEqual(plan.events[1]);
    expect(repaired.events[2]).toEqual(plan.events[2]);
    expect(plan).toEqual(before);
  });

  it("suggests evening return details without rejecting a daytime check-in followed by outings", () => {
    const plan = planFixture(snapshot);
    const hotel = plan.events.find((event) => event.id === "d1-hotel")!;
    hotel.startTime = "15:00";
    hotel.endTime = "15:30";
    plan.events.push({ ...hotel, id: "d1-dinner", type: "meal", title: "晚餐 · 湖滨片区", startTime: "18:00", endTime: "19:00", costDraftCents: 10000 });
    expect(validateGeneratedPlan(plan, snapshot).errors).toEqual([]);
    expect(validateGeneratedPlan(plan, snapshot).warnings.join()).toContain("无需单独增加节点");
    plan.events.push({ ...hotel, id: "d1-back-to-hotel", type: "rest", title: "返回酒店休息 · 湖滨片区", startTime: "20:00", endTime: "21:00", costDraftCents: 0 });
    expect(validateGeneratedPlan(plan, snapshot).errors).toEqual([]);
    const costs = derivePlanCosts(plan.events);
    expect(costs.filter((cost) => cost.category === "accommodation")).toHaveLength(1);
    expect(costs.find((cost) => cost.linkedEventId === "d1-hotel")).toMatchObject({ unitAmountCents: hotel.costDraftCents, nightCount: 1 });
    expect(costs.find((cost) => cost.linkedEventId === "d1-back-to-hotel")?.unitAmountCents ?? 0).toBe(0);
    expect(plan.events.some((event) => event.dayNumber === 2 && event.type === "accommodation")).toBe(false);
  });

  it("accepts returning at 17:30 after an early dinner without an arbitrary 18:00 cutoff", () => {
    const plan = planFixture(snapshot);
    const hotel = plan.events.find((event) => event.id === "d1-hotel")!;
    Object.assign(hotel, { startTime: "17:30", endTime: "17:45" });
    plan.events.push({ ...hotel, id: "d1-dinner", type: "meal", title: "晚餐", startTime: "16:30", endTime: "17:30" });
    expect(validateGeneratedPlan(plan, snapshot).errors).toEqual([]);
  });

  it("accepts an explicit hotel return filed as an activity and only advises about a later night outing", () => {
    const plan = planFixture(snapshot);
    const hotel = plan.events.find((event) => event.id === "d1-hotel")!;
    plan.events.push({ ...hotel, id: "d1-nightwalk", type: "activity", title: "湖畔夜游", startTime: "22:00", endTime: "22:30", costDraftCents: 0 });
    expect(validateGeneratedPlan(plan, snapshot).errors).toEqual([]);
    expect(validateGeneratedPlan(plan, snapshot).warnings.join()).toContain("晚间返回酒店");
    plan.events.push({ ...hotel, id: "d1-return-rest", type: "activity", title: "返回酒店休息", startTime: "22:30", endTime: "23:00", costDraftCents: 0 });
    expect(validateGeneratedPlan(plan, snapshot).errors).toEqual([]);
  });
});
