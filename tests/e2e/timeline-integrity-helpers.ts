import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { advisoryItemSchema, type AdvisoryView } from "../../lib/advisories";
import { derivePlanCosts } from "../../lib/budget";
import { planEventDurationSeconds, preparePlanForStorage, tripDates, validatePlan, type PlanEvent } from "../../lib/plan";
import { placeSchema } from "../../lib/places";
import { requestFixture } from "../helpers/plan-fixtures";

export const timelineIntegrityTitle = "杭州西湖 · 三日轻松漫游";
export const timelineIntegrityRequest = "想去杭州西湖过一个 3 天的慢周末，两个人从上海出发，总预算 4500 元，喜欢自然风景和老街，每天慢慢走，留足吃饭与休息时间，住西湖东侧两晚。";

/** Anonymous, fully persisted fixture shared by regression tests and captures. */
export async function seedTimelineIntegrityTrip(request: APIRequestContext, db: PrismaClient) {
  const created = await request.post("/api/trips", { data: { originalRequest: timelineIntegrityRequest } });
  assert.equal(created.status(), 201, await created.text());
  const { trip } = await created.json() as { trip: { id: string } };
  const snapshot = requestFixture(3, {
    destination: "杭州西湖", startDate: "2026-11-14", endDate: "2026-11-16", pace: "relaxed",
    interests: ["自然风景", "老街", "茶文化"], budgetAmountCents: 450000,
    accommodation: "西湖东侧安静双床房，两晚连住",
  });
  const savedRequest = await request.patch(`/api/trips/${trip.id}/request`, { data: { expectedRequestRevision: 1, request: snapshot } });
  assert.equal(savedRequest.status(), 200, await savedRequest.text());
  const confirmed = await request.post(`/api/trips/${trip.id}/request/confirm`, { data: { expectedRequestRevision: 2 } });
  assert.equal(confirmed.status(), 200, await confirmed.text());

  const dates = tripDates(snapshot);
  const events: PlanEvent[] = [];
  const longNote = "沿已经开放的湖岸步道慢走，在树荫与长椅之间安排充分休息，完整保留上午的核心游览时间。经过岔路时核对园区指示牌，不为了拍照折返；带好身份证、饮水与薄外套。若遇到临时围挡，选择附近开放步道继续游览，先休息再出发。午餐安排在步行可达的街区，途中交通和候车时间独立保留，避免把真正的游览节点误当成过渡事项折叠。";
  function add(day: number, suffix: string, type: PlanEvent["type"], startTime: string, endTime: string, title: string, locationName: string, note: string, costDraftCents = 0) {
    const id = `integrity-d${day}-${suffix}`;
    const event: PlanEvent = {
      id, type, dayNumber: day, date: dates[day - 1], startTime, endTime, title, locationName,
      placeId: `integrity:${id}`, note, costDraftCents, costStatus: "estimated",
      suggestedDurationSeconds: 60, status: "suggested", locked: false,
    };
    event.suggestedDurationSeconds = planEventDurationSeconds(event);
    events.push(event);
  }
  add(1, "preparation", "preparation", "06:00", "06:15", "出发前准备", "出发前准备位置", "带好身份证、充电宝与已确认的交通票据。");
  add(1, "home-breakfast", "meal", "06:15", "06:25", "出发地简单早餐", "出发地早餐位置", "出门前吃一点简单早餐，旅行中仍保留湖滨早餐时段。", 1000);
  add(1, "departure", "departure_transport", "06:30", "07:15", "乘车抵达杭州", "杭州抵达接驳点", "去程时间为测试样本估算，按真实票据核对。", 15000);
  const sights = [
    ["柳浪闻莺湖畔漫步", "南山路寻茶", "河坊街慢游"],
    ["龙井村茶田漫步", "九溪村落散步", "满觉陇品茶"],
    ["断桥与白堤晨游", "孤山园林慢赏", "湖滨街区告别"],
  ];
  for (let day = 1; day <= 3; day++) {
    if (day > 1) add(day, "preparation", "preparation", "07:00", "07:15", day === 3 ? "退房与寄存行李" : "酒店整理随身用品", `第 ${day} 天酒店准备位置`, "核对天气和今天的路线，带好身份证与随身用品。");
    add(day, "breakfast", "meal", "07:30", "08:00", "湖滨早餐", `第 ${day} 天湖滨早餐点`, "坐下来吃一碗热面，早餐结束后再出发。", 3000);
    add(day, "morning-transfer", "local_transport", "08:00", "08:30", "前往晨间游览起点", `第 ${day} 天晨间接驳点`, "步行结合公交前往当日第一处景点；候车、路程和下车后的步行分别留出余量。", 2000);
    add(day, "morning-sight", "activity", "08:30", "11:00", sights[day - 1][0], sights[day - 1][0], longNote, 2000);
    add(day, "lunch", "meal", "11:30", "12:30", "湖畔杭帮菜午餐", `第 ${day} 天午餐街区`, "在当日路线附近找一间明码标价的小馆，两人点两菜一汤，饭后不用着急赶路。", 12000);
    add(day, "rest", "rest", "12:30", "13:00", "午间安静休息", `第 ${day} 天午间休息点`, "在茶馆或有遮阴的长椅坐一会儿，让午后行程保持从容。");
    add(day, "afternoon-transfer", "local_transport", "13:00", "13:30", "前往午后游览街区", `第 ${day} 天午后接驳点`, "这段交通连接两个主要游览区，需要保留完整卡片与时间，不折叠白天路线。", 2000);
    add(day, "afternoon-sight", "activity", "13:30", "15:30", sights[day - 1][1], sights[day - 1][1], "慢慢欣赏街景与自然风物，中途可以找一家茶馆休息，给偶遇的小巷留出自由时间。");
    add(day, "late-sight", "activity", "15:45", "17:15", sights[day - 1][2], sights[day - 1][2], "这是晚餐前最后一个完整游览节点，保持自然文档流，结束后沿附近路线前往餐厅。");
    add(day, "dinner", "meal", "17:30", "18:30", "老城风味晚餐", `第 ${day} 天晚餐街区`, "以一顿从容的家常晚餐结束白天的游览，餐后回酒店或按计划返程。", 14000);
    if (day < 3) add(day, "hotel", "accommodation", "19:00", "21:00", day === 1 ? "入住酒店，休息放松" : "返回酒店休息", `第 ${day} 晚西湖东侧住宿区域`, "两晚连住西湖东侧酒店。放下行李，洗漱休息，为明天留足精力。", 42000);
    else add(day, "return", "return_transport", "19:00", "20:30", "取行李后返程", "杭州返程接驳点", "按实际车票倒推出门时间，预留市内接驳、安检和候车时间。", 15000);
  }

  const now = new Date().toISOString();
  const places = events.map((event, index) => {
    // Spread references around West Lake so every independent stop remains
    // targetable in the real compact map without overlapping synthetic pins.
    const dayEvents = events.filter((item) => item.dayNumber === event.dayNumber);
    const position = dayEvents.findIndex((item) => item.id === event.id);
    const angle = position / dayEvents.length * 2 * Math.PI;
    return placeSchema.parse({
      id: event.placeId, poiId: `node:integrity${index}`, name: event.locationName,
      latitude: 30.245 + Math.sin(angle) * .022, longitude: 120.142 + Math.cos(angle) * .028,
      provider: "osm", city: "杭州市", district: "西湖区", address: `杭州市西湖周边 · ${event.locationName}`,
      adcode: "", category: "tourism", coordinateSystem: "WGS84", precision: "area_reference",
      confirmation: "user_confirmed", confirmedAt: now, retrievedAt: now, source: "OpenStreetMap / Nominatim",
    });
  });
  const content = preparePlanForStorage({ events, pendingItems: [{ id: "integrity-tickets", category: "transport_ticket", title: "核对真实票据与开放时间", reason: "此行程用于回归测试和页面验收，交通时刻及费用为参考估算。", requiredBefore: dates[0] }] });
  const costs = derivePlanCosts(content.events);
  const validation = validatePlan(content, snapshot, costs);
  assert.deepEqual(validation.errors, []);
  const plan = await db.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(content.events), costs: JSON.stringify(costs), places: JSON.stringify(places),
    pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify(validation),
  } });
  await db.trip.update({ where: { id: trip.id }, data: { title: timelineIntegrityTitle, currentPlanVersionId: plan.id, status: "planned" } });
  return { tripId: trip.id, planId: plan.id, events: content.events, places };
}

export type TimelineIntegritySeed = Awaited<ReturnType<typeof seedTimelineIntegrityTrip>>;

export function timelineIntegrityAdvisories(seed: TimelineIntegritySeed): AdvisoryView {
  const items = seed.events.filter((event) => event.id.endsWith("morning-sight")).flatMap((event) => [
    "出发前核对今日开放范围与入口，若临时围挡关闭局部湖岸步道，先选择附近已开放的平缓路线，再按体力慢慢游览，不要为了打卡压缩正常休息时间。",
    "热门时段可能排队，请将预约凭证与身份证提前准备好；遇到等候时间明显增加时，保留午餐与接驳窗口，并与同行人商量缩短非必要的拍照停留。",
    "沿湖道路与路口可能临时调整，请到现场确认公交站点和回程方向，给候车、步行、补水与休息分别留出余量，完整保留下午的主要游览节点。",
  ].map((title, index) => advisoryItemSchema.parse({
    id: `integrity-advisory-${event.dayNumber}-${index}`, category: index === 0 ? "opening_hours" : index === 1 ? "reservation" : "transport",
    severity: index === 0 ? "action" : "attention", status: "active", validity: "unknown", date: event.date,
    title, targetName: event.title, reason: "长提醒内容的真实布局回归样本。", recommendation: "出发前核对信息，并保持主要游览节点完整展开。",
    aiExplanation: null, eventId: event.id, eventIds: [event.id], checklistItemId: null,
    sourceLabel: "匿名测试提醒", sourceUrl: null, retrievedAt: null, applicableFrom: null, applicableUntil: null,
    signature: String(index + 1).repeat(64), acknowledged: false, acknowledgedAt: null,
  })));
  return { tripId: seed.tripId, planVersion: 1, revision: 1, updatedAt: null, aiStatus: "not_configured", weather: [], missingWeatherEventIds: [], items };
}

export async function mockTimelineIntegrityAdvisories(page: Page, seed: TimelineIntegritySeed) {
  await page.route(`**/api/trips/${seed.tripId}/advisories?*`, (route) => route.fulfill({ json: { advisories: timelineIntegrityAdvisories(seed) } }));
}
