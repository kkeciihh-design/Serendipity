import { nextPlanDate, sortPlanEvents, type PlanEvent } from "./plan";

// A nightly stay keeps its stable event identity. Only routing projects its
// explicitly selected next-morning departure onto that date; no new visit is saved.
export function routeDayEvents(events: PlanEvent[], date: string): (PlanEvent & { routeCarryOver?: boolean })[] {
  return sortPlanEvents(events.flatMap((event) => {
    if (event.date === date) return [event];
    if (event.type === "accommodation" && event.accommodationSelection && nextPlanDate(event.date) === date) {
      const time = event.accommodationSelection.morningDepartureTime;
      return [{ ...event, date, endDate: date, startTime: time, endTime: time, routeCarryOver: true }];
    }
    return [];
  }));
}
export function isRoutePair(events: PlanEvent[], fromId: string, toId: string) {
  const to = events.find((event) => event.id === toId);
  if (!to) return false;
  const day = routeDayEvents(events, to.date).filter((event) => event.placeId);
  const index = day.findIndex((event) => event.id === fromId);
  return index >= 0 && day[index + 1]?.id === toId;
}
