import { toGcj02, type Place } from "./places";

type RoutePlace = Pick<Place, "name" | "latitude" | "longitude" | "coordinateSystem">;

/** Amap's public URI opens a search; it does not accept or verify a departure date. */
export function buildAmapTransitLink(from: RoutePlace, to: RoutePlace) {
  const endpoint = (place: RoutePlace) => {
    const coordinate = toGcj02(place, place.coordinateSystem);
    // Commas delimit coordinates and the display name in Amap's URI grammar.
    const name = place.name.replaceAll(",", "，");
    return `${coordinate.longitude.toFixed(6)},${coordinate.latitude.toFixed(6)},${name}`;
  };
  const url = new URL("https://uri.amap.com/navigation");
  url.search = new URLSearchParams({
    from: endpoint(from),
    to: endpoint(to),
    mode: "bus",
    policy: "1",
    coordinate: "gaode",
    src: "Serendipity",
    callnative: "0",
  }).toString();
  return url.toString();
}

export function safeReferenceUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function formatRouteFare(cents: number | null) {
  return cents === null ? "费用待确认" : `${(cents / 100).toFixed(2).replace(/\.?0+$/, "")} 元`;
}

export function chinaDateTimeInput(iso: string) {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
