import { createHash } from "node:crypto";
import { advisoryItemSchema, type AdvisoryItem } from "./advisories";
import type { ChecklistItem } from "./checklist";
import { effectiveEvidenceStatus, type EvidenceFactClient } from "./evidence";
import { catalogEntryForEvent } from "./attractions";
import { restaurantForEvent } from "./restaurants";
import { planEventStart, planEventEnd, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import { toWgs84 } from "./places";
import { effectiveWeatherStatus, isRainyWeather, weatherSummary, WEATHER_SOURCE_URL, type WeatherRecord } from "./weather";

export function weatherTarget(plan: PlanVersionRecord, event: PlanEvent) {
  if (!["activity", "meal", "accommodation"].includes(event.type)) return null;
  const place = plan.places.find((p) => p.id === event.placeId) ?? catalogEntryForEvent(plan, event)?.location ?? restaurantForEvent(plan, event)?.location;
  if (!place) return null;
  const point = toWgs84(place, place.coordinateSystem);
  // Weather is an area forecast. A shared ~1 km cell avoids duplicate queries.
  const latitude = Number(point.latitude.toFixed(2)), longitude = Number(point.longitude.toFixed(2));
  return { latitude, longitude, locationName: place.name, date: event.date, id: `${latitude.toFixed(4)},${longitude.toFixed(4)}:${event.date}` };
}

export function projectAdvisories(input: {
  plan: PlanVersionRecord; checklist: ChecklistItem[]; facts: EvidenceFactClient[];
  weather: WeatherRecord[]; previous: AdvisoryItem[]; now?: Date;
}) {
  const { plan, checklist, facts, previous } = input, now = input.now ?? new Date();
  const items: AdvisoryItem[] = [];
  const add = (event: PlanEvent, key: string, fields: Pick<AdvisoryItem, "category" | "title" | "reason" | "recommendation"> & Partial<AdvisoryItem>) => {
    const linked = checklist.find((c) => !c.deleted && !c.orphaned && c.eventIds.includes(event.id) &&
      (fields.category === "reservation" ? c.group === "reservation" : fields.category === "accommodation" ? c.group === "accommodation" : c.group === "transport"));
    const base = { id: `${key}:${event.id}`, date: event.date, eventId: event.id, eventIds: [event.id],
      targetName: event.locationName || event.title, severity: "attention" as const, validity: "unknown" as const,
      checklistItemId: linked?.id ?? null, sourceLabel: "本计划记录 · 条件规则判断", sourceUrl: null,
      retrievedAt: null, applicableFrom: null, applicableUntil: null, ...fields };
    // Failed first lookups intentionally retain empty source metadata. They
    // still need a readable reminder, including in the shared export snapshot.
    base.sourceLabel = base.sourceLabel.trim() || "本计划记录 · 来源待核对";
    base.sourceUrl = base.sourceUrl?.trim() || null;
    base.reason = base.reason.slice(0, 500);
    // Re-reading unchanged information does not make the user acknowledge it again.
    const signature = createHash("sha256").update(JSON.stringify({ ...base, retrievedAt: null, startTime: event.startTime, endTime: event.endTime, placeId: event.placeId ?? null })).digest("hex");
    const old = previous.find((p) => p.id === base.id && p.signature === signature);
    items.push(advisoryItemSchema.parse({ ...base, signature, aiExplanation: old?.aiExplanation ?? null,
      acknowledged: old?.acknowledged ?? false, acknowledgedAt: old?.acknowledgedAt ?? null, status: old?.acknowledged ? "known" : "active" }));
  };
  for (const event of plan.events) {
    const entry = catalogEntryForEvent(plan, event);
    const opening = facts.find((f) => f.planVersionId === plan.id && f.targetId === event.id && f.field === "opening_hours" && f.lastRefreshStatus !== "needs_review");
    const applies = opening?.applicableFrom && opening.applicableUntil && planEventStart(event).getTime() >= Date.parse(opening.applicableFrom) && planEventEnd(event).getTime() <= Date.parse(opening.applicableUntil);
    const effective = opening ? (["failed", "refreshing"].includes(opening.lastRefreshStatus ?? "") ||
      opening.applicableUntil && now.getTime() > Date.parse(opening.applicableUntil)
      ? "stale" : effectiveEvidenceStatus(opening, now)) : "pending";
    const closure = opening && applies && (effective === "verified" && /^(?:闭馆|关闭|停业|closed)(?:[。.!！\s]|$)/i.test(opening.extractedValue) || effective === "conflict" && opening.sourceDateStatus === "applicable" && /本次到访日闭馆|暂停开放|闭馆|停止入馆/.test(opening.conflictReason ?? ""));
    const exact = entry?.opening.confirmedClosedDates?.find((c) => c.date === event.date && entry.sources.some((s) => s.id === c.sourceId && s.kind === "official" && s.retrievedAt === c.retrievedAt));
    const weekly = entry?.opening.closedWeekdays.includes(new Date(`${event.date}T12:00:00+08:00`).getUTCDay());
    if (closure) add(event, "opening", { category: "opening_hours", severity: "action", validity: "valid", title: "本次开放条件冲突，需调整安排",
      reason: opening.conflictReason || `来源指出本次到访时段关闭：${opening.extractedValue}`, recommendation: "先通过活动编辑或推荐入口调整；标记已知不会解除关闭限制。",
      sourceLabel: opening.sourceTitle, sourceUrl: opening.sourceUrl, retrievedAt: opening.retrievedAt, applicableFrom: opening.applicableFrom, applicableUntil: opening.applicableUntil });
    else if (exact || weekly || (opening && (effective === "stale" || effective === "conflict"))) {
      const source = entry?.sources.find((s) => s.id === (exact?.sourceId ?? entry.opening.sourceIds[0]));
      const confirmedWeekly = weekly && entry?.opening.status === "verified" && entry.opening.applicableFrom && entry.opening.applicableUntil && event.date >= entry.opening.applicableFrom && event.date <= entry.opening.applicableUntil;
      const known = !!(exact || confirmedWeekly);
      add(event, "opening", { category: "opening_hours", severity: known ? "action" : "attention", validity: known ? "valid" : effective === "stale" ? "stale" : "unknown",
        title: known ? "本次日期闭馆，需调整安排" : "开放安排需复核",
        reason: known ? `${event.date} 落在来源明确的闭馆日期内。` : weekly ? "计划日期与目录常规闭馆日重合；节假日及临时安排尚未核实。" : "本活动开放来源已过期、刷新失败或与安排冲突。",
        recommendation: known ? "通过活动编辑或景点推荐调整；已知标记不会使场馆开放。" : "打开本活动的来源入口，核对适用日期与开放条件。",
        sourceLabel: opening?.sourceTitle ?? source?.title ?? "景点开放目录", sourceUrl: opening?.sourceUrl ?? source?.url ?? null,
        retrievedAt: opening?.retrievedAt ?? source?.retrievedAt ?? null, applicableFrom: opening?.applicableFrom ?? null, applicableUntil: opening?.applicableUntil ?? null });
    }
    const reservation = checklist.find((c) => c.group === "reservation" && c.eventIds.includes(event.id) && !c.deleted && !c.orphaned && !c.completed);
    if (reservation) {
      const fact = facts.find((f) => f.planVersionId === plan.id && f.targetId === event.id && f.field === "reservation" && f.lastRefreshStatus !== "needs_review");
      add(event, "reservation", { category: "reservation", title: "预约事项尚未确认", reason: reservation.note || reservation.title,
        recommendation: "在官方入口核对本次要求及本人预约结果，再到出发前清单确认。", checklistItemId: reservation.id,
        sourceLabel: fact?.sourceTitle ?? reservation.sourceLabel, sourceUrl: fact?.sourceUrl ?? reservation.officialUrl,
        retrievedAt: fact?.retrievedAt ?? entry?.sources.find((s) => entry.reservation.sourceIds.includes(s.id))?.retrievedAt ?? null,
        validity: fact && effectiveEvidenceStatus(fact, now) === "verified" ? "valid" : fact && effectiveEvidenceStatus(fact, now) === "stale" ? "stale" : "unknown",
        applicableFrom: fact?.applicableFrom ?? null, applicableUntil: fact?.applicableUntil ?? null });
    }
    const stay = event.accommodationSelection;
    if (event.type === "accommodation" && (!stay || event.date === stay.checkIn)) {
      if (!stay?.checkInFrom || event.startTime < stay.checkInFrom) add(event, "check-in", { category: "accommodation", title: stay?.checkInFrom ? "到店早于入住时间" : "入住时间尚未确认",
        reason: stay?.checkInFrom ? `预计 ${event.startTime} 到店，填写的入住时间为 ${stay.checkInFrom} 起。` : `预计 ${event.startTime} 到店，尚未填写酒店允许入住的时间。`,
        recommendation: "向酒店核对能否提前进房，再通过住宿推荐或活动编辑调整到店安排。", retrievedAt: stay?.selectedAt ?? null,
        sourceLabel: stay ? "用户填写的住宿条件 · 未在线核验" : "本计划住宿安排" });
      if ((!stay?.checkInFrom || event.startTime < stay.checkInFrom || /寄存|行李/.test(event.note ?? "")) && stay?.luggageStorage !== "available") add(event, "luggage", {
        category: "accommodation", title: stay?.luggageStorage === "unavailable" ? "酒店不可寄存行李" : "到店后的行李寄存待确认",
        reason: stay?.luggageStorage === "unavailable" ? "已填写酒店不提供寄存，且当前安排涉及提前到店或行李。" : "尚不能保证到店即可入住，行李寄存也未确认。",
        recommendation: "联系酒店确认寄存时段、费用和大件限制，或安排其他寄存点。", retrievedAt: stay?.selectedAt ?? null });
    }
    const restaurant = restaurantForEvent(plan, event);
    if (restaurant || event.type === "meal" && /排队/.test(event.note ?? "")) {
      const queue = restaurant?.queue;
      const fresh = queue && now.getTime() >= Date.parse(queue.observedAt) && now.getTime() - Date.parse(queue.observedAt) <= 900_000 && Math.abs(planEventStart(event).getTime() - now.getTime()) <= 900_000 && restaurant.sources.some((s) => queue.sourceIds.includes(s.id) && s.kind === "official");
      add(event, "queue", { category: "queue", severity: "info", title: fresh ? "本餐有排队观察记录" : "本餐排队时长未知",
        reason: fresh ? `门店当时观察为 ${queue.minMinutes}–${queue.maxMinutes} 分钟；并非到店保证。` : `已安排 ${event.startTime} 前往${event.locationName || event.title}，尚无适用于到店时刻的可靠排队信息。`,
        recommendation: "到店前向门店确认；若影响后续安排，可在餐厅推荐中比较替代选项。", validity: fresh ? "valid" : queue ? "stale" : "unknown",
        retrievedAt: queue?.observedAt ?? null, sourceLabel: "本餐门店与排队资料" });
    }
    const target = weatherTarget(plan, event), record = target && input.weather.find((w) => w.id === target.id);
    const outdoor = event.type === "activity" && /户外|公园|登山|爬山|徒步|橘子洲|海滩|步道|露营|岳麓书院/.test(`${event.title} ${event.locationName} ${event.note ?? ""}`) && !/纯室内/.test(event.note ?? "");
    if (record && outdoor) {
      const status = effectiveWeatherStatus(record, now);
      if (status === "fresh" && isRainyWeather({ ...record, status })) add(event, "rain", { category: "weather", title: "降水预报可能影响户外活动", validity: "valid",
        reason: `${event.date} ${record.locationName}地区：${weatherSummary({ ...record, status })}。`, recommendation: "备好雨具，确认场地开放和地面情况；可通过活动编辑调整或选择室内备选。",
        sourceLabel: "Open-Meteo · 地区逐日预报", sourceUrl: WEATHER_SOURCE_URL, retrievedAt: record.retrievedAt, applicableFrom: record.applicableFrom, applicableUntil: record.applicableUntil });
    }
  }
  for (const route of plan.routeLegs) {
    if (!route.conflict && route.status !== "unavailable" && !route.manualReference?.requiresReconfirmation) continue;
    const event = plan.events.find((e) => e.id === route.toEventId); if (!event) continue;
    add(event, `transport:${createHash("sha256").update(route.id).digest("hex").slice(0, 16)}`, { category: "transport", severity: "action", title: route.manualReference?.availability === "no_service" ? "关联交通记录无运营" : "关联交通需要重新核对",
      reason: route.conflict || "当前路线不可用或人工接驳资料已失效，不能沿用原耗时。", recommendation: "在地图路线或门到门交通入口重查运营与接驳，保留已确认票面。",
      sourceLabel: route.source, sourceUrl: route.manualReference?.sourceUrl ?? null, retrievedAt: route.retrievedAt,
      eventIds: [route.fromEventId, route.toEventId], validity: "unknown" });
  }
  for (const ticket of plan.tickets.filter((t) => t.status === "active" && t.baggageNote)) {
    const event = plan.events.find((e) => e.id === ticket.eventId); if (!event) continue;
    add(event, `baggage:${createHash("sha256").update(ticket.id).digest("hex").slice(0, 16)}`, { category: "transport", title: "本段交通有行李注意事项",
      reason: ticket.baggageNote!, recommendation: "向实际承运方核对携带、托运和办理截止要求；通过门到门交通查看票面。", sourceLabel: "用户确认的有效票据备注 · 未在线核验" });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || ({ action: 0, attention: 1, info: 2 }[a.severity] - { action: 0, attention: 1, info: 2 }[b.severity]));
}
