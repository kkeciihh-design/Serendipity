import type { MapMarker } from "./map-link";

// A day often starts with a cross-city ferry, train or flight. Fitting the
// viewport to that station as well would zoom the map out to a provincial
// scale, where every destination block collapses into one pixel. The far
// origin stays on the map; it just stops deciding the camera.
export const DAILY_FOCUS_MAX_DISTANCE_KM = 80;

export function haversineKm(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(right.latitude - left.latitude);
  const deltaLongitude = toRadians(right.longitude - left.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(left.latitude)) * Math.cos(toRadians(right.latitude)) *
    Math.sin(deltaLongitude / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)));
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** The densest point of the day: the median refuses to be dragged by one outlier. */
function activityCentre(markers: MapMarker[]) {
  return {
    latitude: median(markers.map((marker) => marker.latitude)),
    longitude: median(markers.map((marker) => marker.longitude)),
  };
}

export type DailyFocus = {
  /** Markers that decide the camera. */
  focus: MapMarker[];
  /** Far origins drawn on the map but excluded from the camera. */
  remote: MapMarker[];
  /** True when nothing could be separated, so the caller keeps the old behaviour. */
  fellBack: boolean;
};

/**
 * Split one day's markers into destination-focus and far cross-city origins.
 * Falls back to the original "fit everything" behaviour whenever separating
 * would leave no focusable node at all, so a pure transit day still renders.
 */
export function splitDailyFocus(
  markers: MapMarker[],
  maxDistanceKm = DAILY_FOCUS_MAX_DISTANCE_KM,
): DailyFocus {
  if (markers.length < 2) return { focus: [...markers], remote: [], fellBack: false };
  const centre = activityCentre(markers);
  const remote = markers.filter((marker) => haversineKm(centre, marker) > maxDistanceKm);
  const focus = markers.filter((marker) => !remote.includes(marker));
  // Dropping the remote origins is only worth it when a real cluster survives.
  if (focus.length < 2) return { focus: [...markers], remote: [], fellBack: true };
  return { focus, remote, fellBack: false };
}

/** A short "🚄 由深圳北站抵达" style label for the excluded origin. */
export function remoteOriginLabel(markers: MapMarker[]) {
  if (!markers.length) return null;
  for (const marker of markers) {
    // Prefer the transfer station itself over the whole event sentence.
    const station = marker.name.match(/[\u4e00-\u9fa5]{2,12}?(?:站|机场|码头|港口)/)?.[0];
    if (station) return `由${station}抵达`;
  }
  const fromEvent = markers
    .flatMap((marker) => marker.events.map((event) => event.title))
    .map((title) => title.match(/[\u4e00-\u9fa5]{2,12}?(?:站|机场|码头|港口)/)?.[0])
    .find(Boolean);
  return `由${fromEvent ?? markers[0].name}抵达`;
}

// A temple district is roughly 200 m across. Fitting it needs a closer ceiling
// than the province-wide 15 used before the far origin was excluded, otherwise
// neighbouring stops keep sharing one pixel.
export const FOCUSED_MAX_ZOOM = 17;

/**
 * Highest zoom allowed for a fitted view. A tiny span gets the closer ceiling so
 * pins actually separate; a wide span keeps the historical 15 so a multi-city
 * day is never zoomed past a readable overview.
 */
export function focusedMaxZoom(
  bounds: { getNorth(): number; getSouth(): number; getEast(): number; getWest(): number },
  tightSpanDegrees = 0.12,
  tightMaxZoom = FOCUSED_MAX_ZOOM,
  defaultMaxZoom = 15,
) {
  const span = Math.max(
    Math.abs(bounds.getNorth() - bounds.getSouth()),
    Math.abs(bounds.getEast() - bounds.getWest()),
  );
  return span > 0 && span < tightSpanDegrees ? tightMaxZoom : defaultMaxZoom;
}

// Two stops a few hundred metres apart -- a temple gate and the hall behind it --
// project onto the same pixel at street zoom. Nudging the *screen* position keeps
// both numbers readable while the geographic pin stays honest about its place.
export const MIN_MARKER_SEPARATION_PX = 26;

/**
 * Screen-space offsets that pull overlapping pins apart. Deterministic: the same
 * markers always fan out the same way. Offsets are presentation only and never
 * change a marker's coordinates.
 */
export function markerSpreadOffsets(
  points: { x: number; y: number }[],
  minSeparation = MIN_MARKER_SEPARATION_PX,
): { x: number; y: number }[] {
  const offsets = points.map(() => ({ x: 0, y: 0 }));
  const placed: { x: number; y: number }[] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    let offset = { x: 0, y: 0 };
    let attempt = 0;
    // Golden-angle spiral: even coverage, no two pins land the same way.
    while (placed.some((other) => Math.hypot(other.x - (point.x + offset.x), other.y - (point.y + offset.y)) < minSeparation) && attempt < 24) {
      attempt++;
      const angle = attempt * 2.3999632297;
      const radius = minSeparation * Math.sqrt(attempt);
      offset = { x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) };
    }
    offsets[index] = offset;
    placed.push({ x: point.x + offset.x, y: point.y + offset.y });
  }
  return offsets;
}
