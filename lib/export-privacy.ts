import { planEventEnd, planEventStart, sortPlanEvents } from "./plan";
import type { ExportSnapshot, MobileExportOptions } from "./export-snapshot";
import { exactTransportTimeCopy } from "./trip-hard-constraints";
const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// A public hub stays public even when the preceding/following step goes home.
// Match a location name, not arbitrary prose such as “火车站旁的我家”.
export const isPublicTransportHubName = (name: string | null | undefined) => {
  const value = (name ?? "").trim();
  return value.length > 1 && value.length <= 100 && !/(?:我家|家里|家中|住址|住宅|小区|单元|\d+室)/.test(value) &&
    /(?:站|机场|航站楼|码头)(?:[（(][^）)]{0,30}[）)])?$/.test(value);
};

// Privacy is a projection, never CSS hiding. No raw model object, route geometry,
// place coordinate, source URL, image or execution location enters the document.
export function exportPrivacy(snapshot: ExportSnapshot, options: MobileExportOptions) {
  const { plan } = snapshot, events = sortPlanEvents(plan.events);
  const departing = events.find((e) => e.type === "departure_transport"), returning = [...events].reverse().find((e) => e.type === "return_transport");
  const privateNames = new Set<string>();
  for (const t of plan.tickets) {
    const name = t.direction === "departure" ? t.chainOriginName : t.chainDestinationName;
    if (name && !isPublicTransportHubName(name)) privateNames.add(name);
  }
  // A street number also identifies public shops. Residential context, an
  // apartment/unit, or the saved private journey endpoints establish privacy.
  const residentialDetails = (s: string) => /(?:住址|住宅|小区|单元|[\d零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+\s*(?:栋|幢|室)|我家\s*[:：]|我家(?:在|位于))/.test(s);
  // Exempt only a complete commercial name, never a POI category or an address.
  // Home directions remain private even when followed by a restaurant suffix.
  const publicHomeBrands = [...new Set([
    ...plan.places.map((p) => p.name), ...events.flatMap((e) => [e.title, e.locationName ?? ""]),
  ])].filter((name) => !residentialDetails(name) &&
    /^我家(?!附近|楼下|楼上|门口|旁边|对面|隔壁|的|在|位于)(?:[\p{L}\p{N}·]{1,40}[（(][^（）()\r\n]{1,30}店[）)]|[\p{L}\p{N}·]{0,40}(?:酸菜鱼|餐厅|餐馆|饭店|饭馆|面馆|面店|火锅|小吃店|咖啡馆|咖啡店|茶馆|超市|便利店|商店|酒店))$/u.test(name))
    .sort((a, b) => b.length - a.length)
    .map((name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"));
  const looksPrivate = (s: string) => {
    if (residentialDetails(s) || /(?:家中|家门|返家|回家)/.test(s)) return true;
    for (const name of publicHomeBrands) s = s.replace(name, "公开商户");
    return /我家/.test(s);
  };
  // Notes can also contain unrelated contact addresses. Only an explicit
  // declaration about this activity's location can make its map point private.
  // Require a boundary after the home label so a shop such as “我家酸菜鱼” is
  // not interpreted as a declaration that the event takes place at home.
  const declaresPrivateLocation = (note: string | null | undefined) => (note ?? "").split(/[。！？!?；;\r\n]/).some((statement) =>
    /^\s*本(?:次)?(?:活动|住宿|休息)(?:地点|地址)\s*(?:[:：]|为|是|在)\s*(?:我家|家中|家里|家门口|自宅|私人住址|私人住宅)(?=$|[\s:：，,（(])/.test(statement));
  const privateIds = new Set(events.filter((e) => !isPublicTransportHubName(e.locationName) && (
    (departing && planEventEnd(e) <= planEventStart(departing)) ||
    (returning && planEventStart(e) >= planEventEnd(returning)) ||
    looksPrivate(`${e.title} ${e.locationName ?? ""}`) || privateNames.has(e.locationName ?? "") || declaresPrivateLocation(e.note)
  )).map((e) => e.id));
  const privatePlaceIds = new Set(plan.places.filter((p) => !isPublicTransportHubName(p.name) && looksPrivate(`${p.name} ${p.address}`)).map((p) => p.id));
  // Close over both identities and their saved aliases before any renderer
  // projects text, maps, photos, or route details. A place detected only through
  // its address must hide every visit, including visits with another label.
  let changed = true;
  while (changed) {
    const before = privateIds.size + privatePlaceIds.size + privateNames.size;
    for (const e of events) if (!isPublicTransportHubName(e.locationName) && (privateIds.has(e.id) || e.placeId && privatePlaceIds.has(e.placeId) || privateNames.has(e.locationName ?? ""))) {
      privateIds.add(e.id);
      if (e.placeId) privatePlaceIds.add(e.placeId);
      if (e.locationName) privateNames.add(e.locationName);
    }
    for (const p of plan.places) if (!isPublicTransportHubName(p.name) && (privatePlaceIds.has(p.id) || privateNames.has(p.name) || privateNames.has(p.address))) {
      privatePlaceIds.add(p.id); privateNames.add(p.name);
      if (p.address) privateNames.add(p.address);
    }
    changed = before !== privateIds.size + privatePlaceIds.size + privateNames.size;
  }
  const seats = plan.tickets.map((t) => t.seat).filter((s): s is string => Boolean(s));
  const clean = (value: string | null | undefined) => {
    let s = exactTransportTimeCopy(value ?? "", plan.requestSnapshot);
    if (!options.includePrivateAddress) {
      for (const token of [...privateNames].filter(Boolean).sort((a, b) => b.length - a.length)) s = s.replaceAll(token, "私人地点已隐藏");
      // Redact residential fragments, never the whole transport paragraph. In
      // particular, a train time contains digits but is not an address.
      s = s.split(/([。！？!?；;，,\r\n])/).map((part) => {
        if (!residentialDetails(part) && !(looksPrivate(part) && /[零〇一二两三四五六七八九十百千万\d]+\s*(?:号|栋|幢|单元|室)/.test(part))) return part;
        // Keep a public transport suffix when an address and station share a
        // clause, e.g. “从我家XX小区1栋出发前往深圳北站”.
        const suffix = part.match(/(?:出发前往|前往|到达|抵达|乘车至|打车至|至|到)([^，。；\r\n]*(?:站|机场|航站楼|码头)[^，。；\r\n]*)$/);
        if (suffix) return `私人地址细节已隐藏，${suffix[0]}`;
        const prefix = part.match(/^([\s\S]*?(?:站|机场|航站楼|码头)[\s\S]*?)(?:返回|回到|回|前往|到)?(?:我家|家里|家中|住址|住宅|私人住宅|小区)/);
        return prefix ? `${prefix[1]}私人地址细节已隐藏` : "私人地址细节已隐藏";
      }).join("").replace(/(?:家里|家中)/g, "私人地点已隐藏");
    }
    if (!options.includeSeats) {
      for (const seat of seats) s = s.replaceAll(seat, "座位已隐藏");
      s = s.replace(/\d{1,2}\s*车(?:厢)?\s*\d{1,3}\s*[A-Fa-f]/g, "座位已隐藏");
    }
    return s.replace(/(?:https?:\/\/|www\.)[^\s<>"'，；]+/gi, "[在线链接省略]")
      .replace(/\b-?\d{1,3}\.\d{4,}\b/g, "[坐标省略]")
      .replace(/\b\d{17}[\dXx]\b/g, "[证件信息省略]")
      .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_-]{12,}/gi, "[密钥省略]");
  };
  return { clean, text: (v: string | null | undefined) => escape(clean(v)), privateIds };
}
