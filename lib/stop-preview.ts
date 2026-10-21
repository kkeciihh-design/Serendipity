/**
 * Three short stop names for a collection card, taken from the current plan's
 * events. Nothing is invented: only real location names and titles are used, and
 * an empty list means the card simply shows fewer tags.
 */

export type PlanEventLike = {
  dayNumber?: number | null;
  startTime?: string | null;
  title?: string | null;
  locationName?: string | null;
  type?: string | null;
};

const NOISE = /^(早餐|午餐|晚餐|下午茶|宵夜|用餐|餐饮|休息|自由活动|入住|退房|出发|抵达|返程|交通|前往|集合|购物|返回)$/;
const TRANSITION = /出发地|住处|家中|车站|高铁|机场|打车|入住|休息|准备/;
const TRANSITION_TYPES = new Set([
  "departure_transport",
  "return_transport",
  "local_transport",
  "preparation",
  "rest",
  "accommodation",
  "hotel_checkin",
  "hotel_checkout",
]);

const PLACE_PARTS = /[·｜|，,。;；:：\-—–—与或至/]+|\s+/;
const TRANSPORT_PLACE = /(?:站|机场|航站楼|码头)$/;

/** Strip the descriptive tail without cutting a complete place name in half. */
export function stopLabel(event: PlanEventLike): string | null {
  const raw = (event.locationName || event.title || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const candidates = raw
    .replace(/[（(][^（）()]*[）)]/g, "")
    .split(PLACE_PARTS)
    .map((part) => part
      .replace(/^(?:前往|抵达|游览|参观|入住|打卡|漫步|慢逛|逛|走|看|吃|品尝|体验)+/, "")
      .replace(/(?:游览|参观|漫步|慢逛|打卡|一日游|半日游)+$/, "")
      .replace(/(?<=[\p{Script=Han}])\s*\d{1,3}$/u, "")
      .trim())
    .filter(Boolean);
  const place = candidates.find((part) => part.length >= 2 && !NOISE.test(part) && !TRANSPORT_PLACE.test(part)) ?? candidates[0] ?? "";
  // Peel the trailing activity verb first so "开元寺游览" reads as "开元寺".
  const label = place.replace(/(?:附近|周边|片区|区域|一带|站出站口|出站口)$/, "").trim();
  if (!label || label.length < 2 || NOISE.test(label)) return null;
  return label;
}

function isTransitionStop(event: PlanEventLike, raw: string) {
  return TRANSITION_TYPES.has(event.type ?? "") || TRANSITION.test(raw);
}

/**
 * Up to `limit` distinct stop names in itinerary order. Duplicates collapse so a
 * card shows three different places rather than the same hotel three times.
 */
export function stopPreview(events: readonly PlanEventLike[] | null | undefined, limit = 3): string[] {
  if (!events?.length) return [];
  const ordered = [...events].sort((left, right) => {
    const day = (left.dayNumber ?? 0) - (right.dayNumber ?? 0);
    return day !== 0 ? day : String(left.startTime ?? "").localeCompare(String(right.startTime ?? ""));
  });
  const labels: string[] = [];
  for (const event of ordered) {
    if (labels.length >= limit) break;
    const raw = (event.locationName || event.title || "").replace(/\s+/g, " ").trim();
    if (isTransitionStop(event, raw)) continue;
    const label = stopLabel(event);
    if (!label || labels.includes(label)) continue;
    labels.push(label);
  }
  return labels;
}

/** Parse a persisted plan `events` column defensively. */
export function parsePlanEvents(value: string | null | undefined): PlanEventLike[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as PlanEventLike[] : [];
  } catch {
    return [];
  }
}
