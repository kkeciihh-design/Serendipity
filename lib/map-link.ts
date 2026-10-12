import { z } from "zod";
import { sortPlanEvents, type PlanEvent } from "./plan";
import type { Place } from "./places";
import type { RouteLeg, RouteMode, RouteStatus } from "./routes";

const circledNumbers = [
  "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩",
  "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳",
] as const;

export function formatVisitNumber(number: number) {
  return circledNumbers[number - 1] ?? `${number}`;
}

export function numberPlanEvents(events: PlanEvent[]) {
  return sortPlanEvents(events).map((event, index) => ({
    event,
    visitNumber: index + 1,
    visitLabel: formatVisitNumber(index + 1),
  }));
}

export function planEventVisitNumber(events: PlanEvent[], eventId: string) {
  return numberPlanEvents(events).find((item) => item.event.id === eventId)?.visitNumber ?? null;
}

export const mapMarkerEventSchema = z.object({
  id: z.string().min(1).max(80),
  visitNumber: z.number().int().min(1).max(64),
  title: z.string().min(1).max(120),
  timeRange: z.string().min(1).max(40),
});

export const mapMarkerSchema = z.object({
  placeId: z.string().min(1).max(120),
  name: z.string().min(1).max(160),
  city: z.string().min(1).max(100),
  address: z.string().max(300),
  precision: z.enum(["poi", "area_reference"]),
  coordinateSystem: z.enum(["GCJ-02", "WGS84"]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  events: z.array(mapMarkerEventSchema).min(1).max(64),
});

export const mapRouteSchema = z.object({
  id: z.string().min(1).max(180),
  fromEventId: z.string().min(1).max(80),
  toEventId: z.string().min(1).max(80),
  mode: z.enum(["walking", "public_transit", "driving"]),
  status: z.enum(["verified", "estimated", "pending_confirmation", "unavailable"]),
  coordinateSystem: z.enum(["WGS84", "GCJ-02"]),
  polyline: z.array(z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })).max(2_000),
});

export type MapRoute = z.infer<typeof mapRouteSchema>;

export type MapMarkerEvent = z.infer<typeof mapMarkerEventSchema>;
export type MapMarker = z.infer<typeof mapMarkerSchema>;

export function buildMapMarkers(events: PlanEvent[], places: Place[]): MapMarker[] {
  const numbered = numberPlanEvents(events);
  const grouped = new Map<string, { place: Place; events: MapMarkerEvent[] }>();
  for (const item of numbered) {
    const place = places.find((candidate) => candidate.id === item.event.placeId);
    if (!place) continue;
    const marker = grouped.get(place.id) ?? {
      place,
      events: [],
    };
    marker.events.push({
      id: item.event.id,
      visitNumber: item.visitNumber,
      title: item.event.title,
      timeRange: `${item.event.startTime}–${item.event.endTime}`,
    });
    grouped.set(place.id, marker);
  }
  return [...grouped.values()].map((marker) => ({
    placeId: marker.place.id,
    name: marker.place.name,
    city: marker.place.city,
    address: marker.place.address,
    precision: marker.place.precision,
    coordinateSystem: marker.place.coordinateSystem,
    latitude: marker.place.latitude,
    longitude: marker.place.longitude,
    events: marker.events,
  }));
}

export function buildMapRoutes(routes: RouteLeg[]): MapRoute[] {
  return routes
    .filter((route) => route.status !== "unavailable" && route.polyline.length > 1)
    .map((route) => ({
      id: route.id,
      fromEventId: route.fromEventId,
      toEventId: route.toEventId,
      mode: route.mode satisfies RouteMode,
      status: route.status satisfies RouteStatus,
      coordinateSystem: route.coordinateSystem,
      polyline: route.polyline,
    }));
}

export function markerLabel(marker: Pick<MapMarker, "events">) {
  return marker.events.map((event) => formatVisitNumber(event.visitNumber)).join("");
}

export function sortMarkerEvents(marker: MapMarker) {
  return [...marker.events].sort(
    (left, right) => left.visitNumber - right.visitNumber,
  );
}
