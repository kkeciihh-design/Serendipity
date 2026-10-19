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
  const end = day.findIndex((event) => event.id === toId);
  return index >= 0 && end > index && day.slice(index + 1, end).every((event) => event.type === "local_transport" &&
    (event.placeId === day[index].placeId || event.placeId === to.placeId));
}

/** A transfer sharing its visit's endpoint is part of that leg, not another stop. */
export function routeWaypointEvents(events: PlanEvent[]): PlanEvent[] {
  const placed = sortPlanEvents(events).filter((event) => event.placeId);
  return placed.filter((event, index) => {
    if (event.type !== "local_transport") return true;
    const before = placed.slice(0, index).reverse().find((item) => item.type !== "local_transport");
    const after = placed.slice(index + 1).find((item) => item.type !== "local_transport");
    return event.placeId !== before?.placeId && event.placeId !== after?.placeId;
  });
}
