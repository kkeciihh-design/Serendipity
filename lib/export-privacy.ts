import { planEventEnd, planEventStart, sortPlanEvents } from "./plan";
import type { ExportSnapshot, MobileExportOptions } from "./export-snapshot";
const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

// Privacy is a projection, never CSS hiding. No raw model object, route geometry,
// place coordinate, source URL, image or execution location enters the document.
export function exportPrivacy(snapshot: ExportSnapshot, options: MobileExportOptions) {
  const { plan } = snapshot, events = sortPlanEvents(plan.events);
  const departing = events.find((e) => e.type === "departure_transport"), returning = [...events].reverse().find((e) => e.type === "return_transport");
  const privateNames = new Set<string>();
  for (const t of plan.tickets) {
    const name = t.direction === "departure" ? t.chainOriginName : t.chainDestinationName;
    if (name) privateNames.add(name);
  }
  const looksPrivate = (s: string) => /(?:家中|家门|住址|住宅|小区|单元|\d+\s*(?:栋|幢|室)|[街路巷道]\s*\d+\s*号|我家|返家|回家)/.test(s);
  const privateIds = new Set(events.filter((e) =>
    (departing && planEventEnd(e) <= planEventStart(departing)) ||
    (returning && planEventStart(e) >= planEventEnd(returning)) ||
    looksPrivate(`${e.title} ${e.locationName ?? ""}`) || privateNames.has(e.locationName ?? "")
  ).map((e) => e.id));
  for (const e of events) if (privateIds.has(e.id) && e.locationName) privateNames.add(e.locationName);
  for (const p of plan.places) if (privateNames.has(p.name) || looksPrivate(`${p.name} ${p.address}`) || events.some((e) => privateIds.has(e.id) && e.placeId === p.id)) {
    privateNames.add(p.name); if (p.address) privateNames.add(p.address);
  }
  const seats = plan.tickets.map((t) => t.seat).filter((s): s is string => Boolean(s));
  const clean = (value: string | null | undefined) => {
    let s = value ?? "";
    if (!options.includePrivateAddress) {
      for (const token of [...privateNames].filter(Boolean).sort((a, b) => b.length - a.length)) s = s.replaceAll(token, "私人地点已隐藏");
      // Unknown addresses in free-form notes must not bypass the known-origin filter.
      if (looksPrivate(s) && /\d/.test(s)) s = "私人地址细节已隐藏";
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
