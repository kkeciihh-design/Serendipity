import { catalogEntryForEvent } from "./attractions";
import { nextPlanDate, sortPlanEvents, type PlanEvent } from "./plan";
import type { PlanVersionRecord } from "./plan-service";
import { ChecklistError, type ChecklistAction, type ChecklistItem } from "./checklist";

const normalize = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
const signature = (event: PlanEvent) => [event.type, event.date, event.endDate ?? event.date, event.startTime, event.endTime, event.title, event.locationName, event.placeId ?? null];
export type ReservationFact = { eventId: string; required: boolean | null; text: string; sourceLabel: string };

export function deriveChecklist(plan: PlanVersionRecord, facts: ReservationFact[] = []): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const dedupeKeys = new Set<string>();
  function add(input: Pick<ChecklistItem, "id" | "title" | "group" | "source" | "sourceLabel"> & Partial<ChecklistItem>) {
    const linkedEvent = input.eventId ? events.find((event) => event.id === input.eventId) : null;
    const location = linkedEvent?.locationName || linkedEvent?.title || input.title;
    const dedupeKey = `${input.group}:${input.date ?? plan.requestSnapshot.startDate}:${normalize(location)}`;
    if (input.eventId && dedupeKeys.has(dedupeKey)) return;
    if (input.eventId) dedupeKeys.add(dedupeKey);
    items.push({ note: "", date: plan.requestSnapshot.startDate, eventId: null, eventIds: [], ticketIds: [],
      sourceKey: input.id, signature: input.id, officialUrl: null, custom: false, completed: false,
      completedAt: null, deleted: false, orphaned: false, changeNote: null, ...input });
  }
  const events = sortPlanEvents(plan.events);
  for (const event of events) {
    const base = { eventId: event.id, eventIds: [event.id], date: event.date,
      sourceKey: JSON.stringify([event.type, event.date, normalize(event.locationName || event.title), event.startTime]),
      signature: JSON.stringify([plan.requestSnapshot.destination, plan.requestSnapshot.travelerCount, signature(event)]) };
    if (["departure_transport", "return_transport"].includes(event.type)) {
      const tickets = plan.tickets.filter((t) => t.eventId === event.id && t.status === "active");
      const train = tickets.length ? tickets.every((t) => t.mode === "train") : /高铁|火车|列车|动车/.test(`${event.title} ${event.note ?? ""}`);
      add({ ...base, id: `transport:${event.id}`, title: `${event.type === "departure_transport" ? "去程" : "返程"}票：核对日期、站点与同行人数`,
        group: "transport", source: tickets.length ? "ticket" : "event", ticketIds: tickets.map((t) => t.id).sort(),
        sourceLabel: tickets.length ? `已关联 ${tickets.length} 张有效票据；仍需自行核对` : "来自行程交通；尚无有效票据",
        note: tickets.length ? tickets.map((t) => `${t.serviceNumber ?? "班次待补"} · ${t.date ?? "日期待补"} ${t.departureTime ?? "时刻待补"} · ${t.fromName ?? "站点待补"} → ${t.toName ?? "站点待补"} · ${t.passengerCount}人`).join("；").slice(0, 500) : "建议提前在 12306 或购票平台预订车票，并核对票面信息。",
        officialUrl: train ? "https://www.12306.cn/" : null,
        signature: JSON.stringify([base.signature, tickets.map((t) => [t.id, t.mode, t.serviceNumber, t.date, t.departureTime, t.arrivalDate, t.arrivalTime, t.fromName, t.toName, t.passengerCount]).sort()]) });
    }
    if (event.type === "accommodation") {
      const stay = event.accommodationSelection;
      const siblings = stay ? events.filter((e) => e.accommodationSelection?.stayId === stay.stayId) : [event];
      if (siblings[0].id !== event.id) continue;
      add({ ...base, id: `accommodation:${stay?.stayId ?? event.id}`, eventIds: siblings.map((e) => e.id), group: "accommodation", source: "event",
        title: `确认住宿：${(event.locationName || event.title).slice(0, 100)}`, sourceLabel: stay?.kind === "hotel" ? "来自已选择的酒店地点；不表示已订房" : "来自住宿区域；具体酒店待确认",
        note: `${stay?.checkIn ?? event.date} 入住 → ${stay?.checkOut ?? nextPlanDate(event.date)} 离店${stay ? ` · ${stay.roomCount}房${stay.nightCount}晚` : ""}。核对预订、入住及行李寄存条件。`,
        signature: JSON.stringify([base.signature, siblings.map(signature), stay ? [stay.kind, stay.checkIn, stay.checkOut, stay.roomCount, stay.checkInFrom, stay.checkOutBy, stay.luggageStorage, stay.conditionNote] : null]) });
    }
    if (event.type === "activity" || event.type === "meal") {
      const entry = event.type === "activity" ? catalogEntryForEvent(plan, event) : null;
      const fact = facts.find((f) => f.eventId === event.id);
      const required = fact ? fact.required : entry?.reservation.required;
      const relevantPending = plan.pendingItems.filter((p) => p.category === "reservation" &&
        [event.locationName, event.title].some((name) => name && normalize(`${p.title} ${p.reason}`).includes(normalize(name))));
      const explicit = /预约|预订/.test(event.note ?? "");
      const noReservation = /无需预约|免预约|不需要预约|不用预约/.test(`${event.note ?? ""} ${fact?.text ?? ""} ${entry?.reservation.text ?? ""}`);
      // A small check only for a venue with reservation information or a concrete request.
      if (required !== false && !noReservation && (entry || fact || relevantPending.length || explicit)) {
        const official = entry?.sources.find((s) => s.kind === "official" && entry.reservation.sourceIds.includes(s.id) && s.url.startsWith("https://"));
        add({ ...base, id: `reservation:${event.id}`, group: "reservation", source: "reservation",
          title: `${required ? "办理并核对预约" : "确认是否需要预约"}：${(event.locationName || event.title).slice(0, 100)}`,
          sourceLabel: fact?.sourceLabel ?? (official ? `参考 ${official.publisher}（${official.retrievedAt.slice(0, 10)}）；出行前复核` : "来自行程预约说明"),
          signature: JSON.stringify([base.signature, required ?? null, fact?.text ?? entry?.reservation.text ?? relevantPending.map((p) => p.reason).join("；"), event.note ?? null]),
          note: ((fact?.text ?? entry?.reservation.text ?? relevantPending.map((p) => p.reason).join("；")) || event.note || "请向场馆确认预约要求。").slice(0, 500),
          officialUrl: official?.url ?? null });
      }
    }
  }
  // Unmatched reservation notes remain visible without inventing an event association.
  for (const pending of plan.pendingItems.filter((p) => p.category === "reservation")) {
    const matched = items.some((item) => item.group === "reservation" && item.eventId && events.some((e) => e.id === item.eventId &&
      [e.locationName, e.title].some((name) => name && normalize(`${pending.title} ${pending.reason}`).includes(normalize(name)))));
    const key = `reservation-note:${normalize(pending.title)}:${pending.requiredBefore ?? ""}`;
    if (!matched && !items.some((i) => i.sourceKey === key)) add({ id: key, sourceKey: key, signature: JSON.stringify([pending.title, pending.reason, pending.requiredBefore]),
      title: pending.title, group: "reservation", source: "reservation", sourceLabel: "来自计划待确认事项；未匹配到具体活动", note: pending.reason, date: pending.requiredBefore });
  }
  add({ id: "essential:identity", title: "带好出行与入住所需的有效证件", group: "essentials", source: "rule", sourceLabel: "基础出行准备", note: "按实际乘车、入住和预约要求准备；无需在这里填写证件号码。" });
  add({ id: "essential:phone", title: "手机、充电器与必要电量", group: "essentials", source: "rule", sourceLabel: "基础出行准备", note: "确认能查看票面和行程；其他随身物品可按需添加。" });
  return items;
}

export function mergeChecklist(previous: ChecklistItem[], plan: PlanVersionRecord, facts: ReservationFact[] = []): ChecklistItem[] {
  const generated = deriveChecklist(plan, facts), used = new Set<string>();
  const result = generated.map((next) => {
    let old = previous.find((i) => !i.custom && i.id === next.id && !used.has(i.id));
    // Regeneration may return new model IDs: reuse only a unique equivalent visit.
    if (!old && generated.filter((i) => i.sourceKey === next.sourceKey).length === 1) {
      const matches = previous.filter((i) => !i.custom && !used.has(i.id) && i.sourceKey === next.sourceKey);
      if (matches.length === 1) old = matches[0];
    }
    if (!old) return next;
    used.add(old.id);
    const changed = old.signature !== next.signature || old.orphaned;
    return { ...next, id: old.id, completed: changed ? false : old.completed,
      completedAt: changed ? null : old.completedAt, deleted: old.deleted,
      changeNote: changed ? "关联日期、安排或票据已变化，请重新核对。" : old.changeNote };
  });
  for (const old of previous) {
    if (used.has(old.id)) continue;
    if (old.custom) {
      const event = plan.events.find((e) => e.id === old.eventId);
      result.push({ ...old, orphaned: false,
        changeNote: old.eventId && !event ? "原关联活动已移除；自建事项和完成记录已保留，可编辑关联。" :
          event && old.date && old.date !== event.date ? "关联活动日期已变化；自建事项日期和完成记录已保留，请核对。" : old.changeNote });
    } else result.push({ ...old, orphaned: true, changeNote: "关联活动或预约已移除，不再计入当前准备进度；原记录已保留。" });
  }
  return result;
}

export function applyChecklistAction(items: ChecklistItem[], action: ChecklistAction, plan: PlanVersionRecord, now: string): ChecklistItem[] {
  if (action.action === "sync") return items;
  const next = structuredClone(items);
  if (action.action === "add" || action.action === "edit") {
    if (action.fields.eventId) {
      const event = plan.events.find((e) => e.id === action.fields.eventId);
      if (!event) throw new ChecklistError("关联活动已不存在，请重新选择。");
      if (action.fields.date !== event.date) throw new ChecklistError("关联事项日期须与所选活动一致。");
    }
    if (action.action === "add") {
      const id = `custom:${action.id}`;
      if (next.some((i) => i.id === id)) throw new ChecklistError("该自建事项已保存，请重新读取清单。", 409);
      if (next.filter((i) => i.custom && !i.deleted).length >= 200) throw new ChecklistError("自建事项最多200项，请先整理已不需要的事项。");
      next.push({ ...action.fields, id, eventIds: action.fields.eventId ? [action.fields.eventId] : [], ticketIds: [], source: "custom", sourceLabel: "用户自建", sourceKey: id, signature: id,
        officialUrl: null, custom: true, completed: false, completedAt: null, deleted: false, orphaned: false, changeNote: null });
      return next;
    }
  }
  const item = next.find((i) => i.id === action.id);
  if (!item) throw new ChecklistError("事项已变化，请重新读取清单。", 409);
  if (action.action === "edit") {
    if (!item.custom || item.deleted) throw new ChecklistError("只能编辑未删除的自建事项。");
    Object.assign(item, action.fields, { eventIds: action.fields.eventId ? [action.fields.eventId] : [], changeNote: null });
  } else if (action.action === "complete") {
    if (item.orphaned || item.deleted) throw new ChecklistError("已移除或删除的事项不能勾选。");
    if (item.completed !== action.completed) Object.assign(item, { completed: action.completed, completedAt: action.completed ? now : null });
    item.changeNote = null;
  } else if (action.action === "delete") item.deleted = true;
  else if (action.action === "restore") item.deleted = false;
  return next;
}
