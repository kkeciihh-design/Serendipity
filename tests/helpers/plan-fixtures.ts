import { nextPlanDate, planEventDurationSeconds, tripDates, type PlanContent, type PlanEvent } from "../../lib/plan";
import { emptyRequestSnapshot, type RequestSnapshot } from "../../lib/trip-request";

export function requestFixture(days = 2, overrides: Partial<RequestSnapshot> = {}): RequestSnapshot {
  const startDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  let endDate = startDate;
  for (let day = 1; day < days; day++) endDate = nextPlanDate(endDate);
  return {
    ...emptyRequestSnapshot(), destination: "长沙", startDate, endDate,
    travelerCount: 2, budgetAmountCents: 150000, budgetScope: "total", pace: "balanced",
    interests: ["博物馆"], accommodation: "市中心安静双床房", constraints: ["不自驾"],
    ...overrides,
  };
}

export function planFixture(snapshot: RequestSnapshot): PlanContent {
  const dates = tripDates(snapshot);
  const events: PlanEvent[] = [];
  function add(day: number, id: string, type: PlanEvent["type"], startTime: string, endTime: string, title: string) {
    const event: PlanEvent = {
      id, type, dayNumber: day, date: dates[day - 1], startTime, endTime, title,
      locationName: title, suggestedDurationSeconds: 3600, costDraftCents: 1800,
      costStatus: "estimated", status: "suggested", locked: false, note: null,
    };
    event.suggestedDurationSeconds = planEventDurationSeconds(event);
    events.push(event);
  }
  for (let day = 1; day <= dates.length; day++) {
    add(day, `d${day}-preparation`, "preparation", "06:00", "06:15", "出行准备");
    add(day, `d${day}-breakfast`, "meal", "08:00", "08:30", "早餐");
    add(day, `d${day}-activity`, "activity", "10:00", "12:00", "Example Museum");
    add(day, `d${day}-lunch`, "meal", "12:30", "13:30", "午餐");
    add(day, `d${day}-rest`, "rest", "14:00", "14:30", "休息");
    if (day < dates.length) add(day, `d${day}-hotel`, "accommodation", "20:00", "22:00", "住宿区域");
  }
  add(1, "departure", "departure_transport", "06:30", "07:30", "去程交通");
  add(dates.length, "return", "return_transport", "17:00", "18:30", "返程交通");
  return { events, pendingItems: [{ id: "tickets", category: "transport_ticket", title: "车票待确认", reason: "没有实时票务信息", requiredBefore: dates[0] }] };
}
