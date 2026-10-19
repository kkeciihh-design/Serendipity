import type { PlanContent, PlanEvent } from "./plan";
import type { RequestSnapshot } from "./trip-request";
import { exactTransportTimeCopy } from "./trip-hard-constraints";

function visitClosingTime(event: PlanEvent, snapshot: RequestSnapshot) {
  if (event.type !== "activity") return null;
  const name = `${event.title} ${event.locationName ?? ""}`;
  if (/夜场|夜游专场|夜间开放/.test(`${name} ${event.note ?? ""}`)) return null;
  if (/开元寺/.test(name) && /泉州/.test(snapshot.destination ?? "")) return "18:00";
  return /寺(?:庙)?|博物馆|博物院|古迹|纪念馆|故居|遗址/.test(name) ? "17:30" : null;
}

export function normalizeGeneratedQuality(plan: PlanContent, snapshot: RequestSnapshot): PlanContent {
  return { events: plan.events.map((event) => {
    const closing = visitClosingTime(event, snapshot);
    let note = exactTransportTimeCopy(event.note ?? "", snapshot);
    let endTime = event.endTime;
    if (closing && event.startTime < closing && endTime > closing && (!event.endDate || event.endDate === event.date)) {
      endTime = closing;
      note += ` 建议在${closing}前结束参观；开放安排请以场馆当日公告为准。`;
    }
    if (event.type === "departure_transport" && event.endTime >= "11:00" && event.endTime <= "14:00" && !/寄存.{0,15}(?:前台|柜)|(?:前台|寄存柜).{0,15}寄存|酒店前台|车站寄存柜/.test(note)) {
      note += " 到达后先将行李寄存于酒店前台；尚未到入住时间时提前联系前台确认，或使用车站寄存柜。先吃午餐，再开始游览。";
    }
    return { ...event, endTime, note: note || null };
  }), pendingItems: plan.pendingItems.map((item) => ({ ...item, title: exactTransportTimeCopy(item.title, snapshot), reason: exactTransportTimeCopy(item.reason, snapshot) })) };
}

export function validateVisitHours(events: PlanEvent[], snapshot: RequestSnapshot) {
  return events.flatMap((event) => {
    const closing = visitClosingTime(event, snapshot);
    return closing && (event.startTime >= "17:30" || event.endTime > closing || event.endDate && event.endDate !== event.date)
      ? [`${event.title} 应在日间安排并于${closing}前结束；请将寺庙、博物馆或古迹参观提前，夜场需明确开放依据。`] : [];
  });
}

export function validateArrivalLunch(events: PlanEvent[]) {
  const arrival = events.find((event) => event.type === "departure_transport");
  if (!arrival || arrival.endTime < "11:00" || arrival.endTime > "14:00") return [];
  const lunch = events.find((event) => event.date === arrival.date && event.type === "meal" && event.startTime >= arrival.endTime && event.startTime <= "14:30");
  return lunch ? [] : ["首日中午到达后应先寄存行李并在14:30前安排午餐，再开始景区游览。"];
}
