import { z } from "zod";

export const coordinateSchema = z.object({
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
});
export type Coordinate = z.infer<typeof coordinateSchema>;

export const placeCandidateSchema = coordinateSchema.extend({
  provider: z.enum(["amap", "osm"]),
  poiId: z.string().regex(/^[A-Za-z0-9:]{1,80}$/),
  name: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(100),
  district: z.string().max(100),
  address: z.string().max(300),
  adcode: z.string().max(30),
  category: z.string().max(240),
  coordinateSystem: z.enum(["GCJ-02", "WGS84"]),
  retrievedAt: z.iso.datetime(),
});
export type PlaceCandidate = z.infer<typeof placeCandidateSchema>;
export const placeSchema = placeCandidateSchema.extend({
  id: z.string().min(1).max(120),
  precision: z.enum(["poi", "area_reference"]),
  confirmation: z.literal("user_confirmed"),
  confirmedAt: z.iso.datetime(),
  source: z.enum(["高德地图地点搜索", "OpenStreetMap / Nominatim"]),
});
export type Place = z.infer<typeof placeSchema>;
export type SignedPlaceCandidate = PlaceCandidate & { selectionToken: string };

export function placeIdentity(candidate: PlaceCandidate, precision: Place["precision"]) {
  return `${candidate.provider}:${candidate.poiId}:${precision}`;
}

export function validatePlaceReferences(events: { placeId?: string | null }[], places: Place[]) {
  const ids = new Set(places.map((place) => place.id));
  if (ids.size !== places.length || events.some((event) => event.placeId && !ids.has(event.placeId))) {
    throw new Error("地点引用不完整，请重新读取计划。");
  }
}

// Only the adapter converts coordinates. Provider POIs already use GCJ-02.
// WGS84 outside mainland China's conversion bounds remains unchanged.
export function toGcj02(coordinate: Coordinate, source: "WGS84" | "GCJ-02"): Coordinate {
  const { longitude: lng, latitude: lat } = coordinateSchema.parse(coordinate);
  if (source === "GCJ-02" || lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) {
    return { longitude: lng, latitude: lat };
  }
  const x = lng - 105;
  const y = lat - 35;
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  const wave = (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  dLat += wave + (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3
    + (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  dLng += wave + (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3
    + (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  const radLat = lat / 180 * Math.PI;
  const magic = 1 - 0.006693421622965943 * Math.sin(radLat) ** 2;
  dLat = dLat * 180 / ((6378245 * (1 - 0.006693421622965943)) / (magic * Math.sqrt(magic)) * Math.PI);
  dLng = dLng * 180 / (6378245 / Math.sqrt(magic) * Math.cos(radLat) * Math.PI);
  return { longitude: lng + dLng, latitude: lat + dLat };
}

export function toWgs84(coordinate: Coordinate, source: "WGS84" | "GCJ-02"): Coordinate {
  const input = coordinateSchema.parse(coordinate);
  if (source === "WGS84") return input;
  let estimate = input;
  for (let iteration = 0; iteration < 4; iteration++) {
    const converted = toGcj02(estimate, "WGS84");
    estimate = { longitude: estimate.longitude + input.longitude - converted.longitude, latitude: estimate.latitude + input.latitude - converted.latitude };
  }
  return estimate;
}
