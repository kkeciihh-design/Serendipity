import { z } from "zod";
import { planEventDurationSeconds, planEventEnd, planEventStart, sortPlanEvents, type PlanEvent } from "./plan";

export const ticketModeSchema = z.enum(["train", "flight"]);
export type TicketMode = z.infer<typeof ticketModeSchema>;

export const ticketDirectionSchema = z.enum(["departure", "return"]);
export type TicketDirection = z.infer<typeof ticketDirectionSchema>;

export const ticketStatusSchema = z.enum([
  "draft",
  "active",
  "cancelled",
  "replaced",
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

const ticketDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "票面日期必须使用 YYYY-MM-DD。")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "票面日期不存在。");

const ticketTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "票面时刻必须使用 HH:mm。");

const cutoffMinutes = z
  .number()
  .int()
  .min(0)
  .max(240)
  .nullable();

const accessModeSchema = z.enum(["walking", "public_transit", "driving"]);
export type TicketAccessMode = z.infer<typeof accessModeSchema>;

export const ticketCoreSchema = z.object({
  eventId: z.string().trim().min(1).max(80),
  direction: ticketDirectionSchema,
  mode: ticketModeSchema,
  serviceNumber: z.string().trim().max(40).nullable(),
  date: ticketDate.nullable(),
  departureTime: ticketTime.nullable(),
  arrivalDate: ticketDate.nullable(),
  arrivalTime: ticketTime.nullable(),
  fromName: z.string().trim().max(120).nullable(),
  fromDetail: z.string().trim().max(120).nullable(),
  toName: z.string().trim().max(120).nullable(),
  toDetail: z.string().trim().max(120).nullable(),
  chainOriginName: z.string().trim().max(120).nullable(),
  chainDestinationName: z.string().trim().max(120).nullable(),
  accessMode: accessModeSchema.nullable(),
  accessDurationMinutes: z.number().int().min(1).max(1_440).nullable(),
  accessFareCents: z.number().int().min(0).max(1_000_000).nullable(),
  accessNote: z.string().trim().max(240).nullable(),
  egressMode: accessModeSchema.nullable(),
  egressDurationMinutes: z.number().int().min(1).max(1_440).nullable(),
  egressFareCents: z.number().int().min(0).max(1_000_000).nullable(),
  egressNote: z.string().trim().max(240).nullable(),
  baggageNote: z.string().trim().max(240).nullable(),
  passengerCount: z.number().int().min(1).max(20),
  fareCents: z.number().int().min(0).max(2_000_000_000).nullable(),
  checkInCutoffMinutes: cutoffMinutes,
  bagDropCutoffMinutes: cutoffMinutes,
  boardingCutoffMinutes: cutoffMinutes,
  bufferMinutes: z.number().int().min(0).max(240),
  note: z.string().trim().max(240).nullable(),
});

export type TicketCore = z.infer<typeof ticketCoreSchema>;

// Confirmation records a real-world fact. Missing or conflicting details are
// kept verbatim and reported by validation; they must never block that fact.
export const activeTicketCoreSchema = ticketCoreSchema;

export const ticketSchema = ticketCoreSchema.extend({
  id: z.string().trim().min(1).max(80),
  status: ticketStatusSchema,
  confirmedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  replacedAt: z.iso.datetime().nullable(),
  replacedByTicketId: z.string().trim().min(1).max(80).nullable().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Ticket = z.infer<typeof ticketSchema>;

export const ticketActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_draft"),
    ticket: ticketCoreSchema,
  }),
  z.object({
    action: z.literal("activate"),
    ticket: activeTicketCoreSchema,
    acknowledged: z.literal(true, {
      error: "请确认本人已核对这张票面。",
    }),
  }),
  z.object({
    action: z.literal("cancel"),
    ticketId: z.string().trim().min(1).max(80),
    acknowledged: z.literal(true, {
      error: "请确认本人已在官方平台办妥这张票的退票。",
    }),
  }),
  z.object({
    action: z.literal("activate_draft"),
    ticketId: z.string().trim().min(1).max(80),
    acknowledged: z.literal(true, {
      error: "请确认本人已核对这张草稿票面。",
    }),
  }),
  z.object({
    action: z.literal("update_details"),
    ticketId: z.string().trim().min(1).max(80),
    ticket: ticketCoreSchema,
    acknowledged: z.literal(true, { error: "请核对补充的票面资料及接驳参考。" }),
  }),
  z.object({
    action: z.literal("replace"),
    ticketId: z.string().trim().min(1).max(80),
    replacement: activeTicketCoreSchema,
    acknowledged: z.literal(true, {
      error: "请核对新票和指定原票后再确认替换。",
    }),
  }),
]);

export type TicketAction = z.infer<typeof ticketActionSchema>;

export const ticketStatusLabels: Record<TicketStatus, string> = {
  draft: "草稿",
  active: "当前有效",
  cancelled: "已退票",
  replaced: "已替换",
};

export const ticketModeLabels: Record<TicketMode, string> = {
  train: "高铁/火车",
  flight: "飞机",
};

export const ticketDirectionLabels: Record<TicketDirection, string> = {
  departure: "去程",
  return: "返程",
};

function newTicket(core: TicketCore, status: TicketStatus, now = new Date()): Ticket {
  const timestamp = now.toISOString();
  return ticketSchema.parse({
    ...core,
    id: `ticket-${globalThis.crypto.randomUUID()}`,
    status,
    confirmedAt: status === "active" ? timestamp : null,
    cancelledAt: null,
    replacedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function createDraftTicket(core: TicketCore, now = new Date()) {
  return newTicket(core, "draft", now);
}

export function activateTicket(core: TicketCore, now = new Date()) {
  return newTicket(core, "active", now);
}

export function activateDraftTicket(existing: Ticket, now = new Date()) {
  if (existing.status !== "draft") {
    throw new Error("只有草稿票可以确认生效。");
  }
  return {
    ...existing,
    status: "active" as const,
    confirmedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function cancelTicket(existing: Ticket, now = new Date()) {
  return {
    ...existing,
    status: "cancelled" as const,
    cancelledAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function replaceTicket(existing: Ticket, replacementCore: TicketCore, now = new Date()) {
  const replacement = newTicket(replacementCore, "active", now);
  if (replacement.id === existing.id) {
    throw new Error("替换票不能与原票完全相同。");
  }
  const replaced = {
    ...existing,
    status: "replaced" as const,
    replacedAt: now.toISOString(),
    replacedByTicketId: replacement.id,
    updatedAt: now.toISOString(),
  };
  return { replaced, replacement };
}

export function updateTicketDetails(existing: Ticket, core: TicketCore, now = new Date()): Ticket {
  if (existing.status !== "draft" && existing.status !== "active") {
    throw new Error("历史票面保持只读，请补充当前有效票。");
  }
  if (existing.status === "active") {
    const protectedFields: Array<keyof TicketCore> = ["eventId", "direction", "mode", "serviceNumber", "date", "departureTime",
      "arrivalDate", "arrivalTime", "fromName", "fromDetail", "toName", "toDetail", "passengerCount", "fareCents"];
    for (const key of protectedFields) {
      if (existing[key] !== null && existing[key] !== "" && existing[key] !== core[key]) {
        throw new Error("已确认的班次、日期、站点、人数或票面金额不能直接改写；仅可补空白资料，真实改签请使用替换指定票。");
      }
    }
  }
  return ticketSchema.parse({ ...existing, ...core, updatedAt: now.toISOString() });
}

function activeConstraintSignature(ticket: Ticket) {
  return JSON.stringify([
    ticket.mode,
    ticket.serviceNumber,
    ticket.date,
    ticket.departureTime,
    ticket.arrivalDate,
    ticket.arrivalTime,
    ticket.fromName,
    ticket.fromDetail,
    ticket.toName,
    ticket.toDetail,
  ]);
}

export function isActiveTicket(ticket: Ticket) {
  return ticket.status === "active" && ticket.confirmedAt !== null;
}

function ticketTimestamp(date: string | null, time: string | null) {
  return date && time ? Date.parse(`${date}T${time}:00+08:00`) : null;
}

/** Reference timing only; no official timetable or formal red-line inference. */
export function ticketChain(ticket: TicketCore) {
  const departure = ticketTimestamp(ticket.date, ticket.departureTime);
  const arrival = ticketTimestamp(ticket.arrivalDate, ticket.arrivalTime);
  const cutoffsKnown = ticket.mode === "train" ? ticket.boardingCutoffMinutes !== null : (
    ticket.checkInCutoffMinutes !== null && ticket.bagDropCutoffMinutes !== null &&
    ticket.boardingCutoffMinutes !== null
  );
  const handlingMinutes = Math.max(ticket.checkInCutoffMinutes ?? 0,
    ticket.bagDropCutoffMinutes ?? 0, ticket.boardingCutoffMinutes ?? 0);
  const hubReady = departure !== null && cutoffsKnown
    ? departure - (handlingMinutes + ticket.bufferMinutes) * 60_000 : null;
  const iso = (value: number | null) => value === null ? null : new Date(value).toISOString();
  return {
    departureAt: iso(departure), arrivalAt: iso(arrival), hubReadyAt: iso(hubReady),
    originDepartureAt: iso(hubReady !== null && ticket.accessDurationMinutes !== null
      ? hubReady - ticket.accessDurationMinutes * 60_000 : null),
    destinationArrivalAt: iso(arrival !== null && ticket.egressDurationMinutes !== null
      ? arrival + ticket.egressDurationMinutes * 60_000 : null),
  };
}

export function ticketWarnings(ticket: Ticket, events: PlanEvent[] = []) {
  if (!isActiveTicket(ticket)) return [];
  const prefix = `${ticket.serviceNumber || "已确认票据"}：`;
  const warnings: string[] = [];
  const required: Array<[keyof TicketCore, string]> = [
    ["serviceNumber", "车次/航班号"], ["date", "出发日期"], ["departureTime", "出发时刻"],
    ["arrivalDate", "到达日期"], ["arrivalTime", "到达时刻"], ["fromName", "出发站点/机场"],
    ["toName", "到达站点/机场"], ["chainOriginName", "门到门起点"], ["chainDestinationName", "门到门终点"],
    ["accessMode", "出发接驳方式"], ["accessDurationMinutes", "出发接驳耗时"],
    ["egressMode", "到达接驳方式"], ["egressDurationMinutes", "到达接驳耗时（含出站/取行李）"],
  ];
  const missing = required.filter(([key]) => ticket[key] === null || ticket[key] === "").map(([, label]) => label);
  if (missing.length) warnings.push(`${prefix}${missing.join("、")}待补；已保存真实票面，完整交通链尚不能确认。`);
  if (ticket.mode === "flight") {
    if (!ticket.fromDetail || !ticket.toDetail) warnings.push(`${prefix}出发/到达航站楼待确认，不同航站楼不能视为同一接驳点。`);
    const missingCutoffs = [
      [ticket.checkInCutoffMinutes, "值机"], [ticket.bagDropCutoffMinutes, "托运"], [ticket.boardingCutoffMinutes, "登机"],
    ].filter(([value]) => value === null).map(([, label]) => label);
    if (missingCutoffs.length) warnings.push(`${prefix}${missingCutoffs.join("、")}截止待确认；请核对航空公司规定，不适用的办理项可明确填 0。`);
  }
  if (ticket.mode === "train" && ticket.boardingCutoffMinutes === null) warnings.push(`${prefix}检票截止待确认，不能把未知截止当作 0 分钟；接驳出发时刻待补。`);
  if (!ticket.baggageNote) warnings.push(`${prefix}行李及出站/取行李条件待确认，到达接驳耗时应包含这些步骤。`);
  if (ticket.accessMode === "public_transit" || ticket.egressMode === "public_transit") {
    warnings.push(`${prefix}公交/地铁接驳仅为人工耗时参考，适用日期、末班车和等待时间需另查；${ticket.direction === "return" ? "返程到站后回家" : "门到门"}接驳尚未获班次保证。`);
  }
  if (ticket.accessMode === "driving" && ticket.accessFareCents === null ||
    ticket.egressMode === "driving" && ticket.egressFareCents === null) {
    warnings.push(`${prefix}自驾接驳费用待确认，油费、路费和停车费不能按 0 元处理。`);
  }
  const chain = ticketChain(ticket);
  const departure = chain.departureAt && Date.parse(chain.departureAt);
  const arrival = chain.arrivalAt && Date.parse(chain.arrivalAt);
  if (typeof departure === "number" && typeof arrival === "number" && (arrival <= departure || arrival - departure > 86_400_000)) {
    warnings.push(`${prefix}票面到达须晚于出发，且当前单项日程最多表达 24 小时；票面原值保留，日程时刻仅供参考并标为冲突。`);
  }
  const ordered = sortPlanEvents(events);
  const index = ordered.findIndex((event) => event.id === ticket.eventId);
  if (index >= 0) {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    if (previous && chain.originDepartureAt && planEventEnd(previous).getTime() > Date.parse(chain.originDepartureAt)) {
      warnings.push(`${prefix}上一项「${previous.title}」结束后无法完成接驳及办理缓冲，无法衔接；不改变已确认票面。`);
    }
    if (next && chain.destinationArrivalAt && Date.parse(chain.destinationArrivalAt) > planEventStart(next).getTime()) {
      warnings.push(`${prefix}到站后完成出站及接驳将晚于「${next.title}」，无法衔接；请调整后续安排。`);
    }
  }
  return warnings;
}

export function validateTickets(tickets: Ticket[], events: PlanEvent[]) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const eventsById = new Map(events.map((event) => [event.id, event]));

  for (const ticket of tickets) {
    if (ids.has(ticket.id)) errors.push(`票据 ID 重复：${ticket.id}。`);
    ids.add(ticket.id);
    const event = eventsById.get(ticket.eventId);
    if (!event) {
      errors.push(`票据 ${ticket.id} 关联的日程不存在。`);
      continue;
    }
    const expectedType = ticket.direction === "departure"
      ? "departure_transport"
      : "return_transport";
    if (event.type !== expectedType) {
      errors.push(`票据 ${ticket.id} 的方向与关联日程不一致。`);
    }
    if (ticket.status === "active" && ticket.confirmedAt === null) errors.push(`票据 ${ticket.id} 尚无用户确认时间，不能成为有效约束。`);
    warnings.push(...ticketWarnings(ticket, events));
  }

  const replacedTargets = new Set(
    tickets.filter((ticket) => ticket.status === "replaced").map((ticket) => ticket.replacedByTicketId),
  );
  for (const target of replacedTargets) {
    if (target && !tickets.some((ticket) => ticket.id === target)) {
      errors.push(`替换票据 ${target} 不存在。`);
    }
  }

  for (const event of events) {
    if (event.type !== "departure_transport" && event.type !== "return_transport") continue;
    const active = tickets.filter((ticket) => isActiveTicket(ticket) && ticket.eventId === event.id);
    if (active.length === 0) {
      // Unticketed plans already expose their pending-ticket items. Preserve
      // existing planned semantics; a removed real ticket needs a new warning.
      if (tickets.some((ticket) => ticket.eventId === event.id && ticket.confirmedAt)) warnings.push(
        `${event.title} 尚无 active 票面；当前主交通不是固定约束，请购票或确认已有票面。`,
      );
      continue;
    }
    const signatures = new Set(active.map(activeConstraintSignature));
    if (signatures.size > 1) {
      warnings.push(
        `${event.title} 有 ${active.length} 张 active 票但班次/时刻不一致；已保存真实票面，当前单线行程无法同时表达，请确认分工或保留冲突提示。`,
      );
    }
  }

  return { errors, warnings };
}

export function applyTicketsToEvents(events: PlanEvent[], tickets: Ticket[], previousTickets: Ticket[] = []): PlanEvent[] {
  return events.map((event) => {
    if (event.type !== "departure_transport" && event.type !== "return_transport") {
      return event;
    }
    const active = tickets.filter(
      (ticket) => isActiveTicket(ticket) && ticket.eventId === event.id,
    );
    if (active.length === 0) {
      return event.ticketManaged
        ? { ...event, status: "suggested" as const, locked: false, ticketManaged: false, ticketTimingPending: false,
            title: event.type === "departure_transport" ? "去程交通（候选待确认）" : "返程交通（候选待确认）" }
        : event;
    }

    const signatures = new Set(active.map(activeConstraintSignature));
    const shared = active[0];
    const previous = previousTickets.find((ticket) => isActiveTicket(ticket) && ticket.eventId === event.id);
    const hubChanged = previous && (previous.fromName !== shared.fromName || previous.fromDetail !== shared.fromDetail);
    const directionLabel = shared.direction === "departure" ? "去程" : "返程";
    const consistent = signatures.size === 1;
    const departure = ticketTimestamp(shared.date, shared.departureTime);
    const arrival = ticketTimestamp(shared.arrivalDate, shared.arrivalTime);
    const timing = signatures.size === 1 && shared.date && shared.departureTime &&
      shared.arrivalDate && shared.arrivalTime && departure !== null && arrival !== null &&
      arrival > departure && arrival - departure <= 86_400_000
      ? {
          date: shared.date,
          startTime: shared.departureTime,
          endDate: shared.arrivalDate,
          endTime: shared.arrivalTime,
        }
      : null;
    const updated: PlanEvent = {
      ...event,
      ...(timing ?? {}),
      status: "confirmed",
      locked: true,
      ticketManaged: true,
      ticketTimingPending: !timing,
      title: consistent && shared.serviceNumber
        ? `${directionLabel}：${shared.serviceNumber}`
        : `${directionLabel}：${consistent ? "票面待补" : "多班次冲突"}`,
      locationName: consistent && shared.fromName
        ? shared.fromName
        : `${directionLabel}车站/机场待核对`,
      // Existing map coordinates are not evidence for a changed station or
      // terminal. A new location requires explicit confirmation.
      placeId: event.locationName === shared.fromName && consistent && !hubChanged ? event.placeId : null,
    };
    if (timing) {
      updated.suggestedDurationSeconds = planEventDurationSeconds(updated);
    }
    return updated;
  });
}

export function ticketChangedEventIds(before: PlanEvent[], after: PlanEvent[]) {
  const beforeById = new Map(before.map((event) => [event.id, event]));
  return after
    .filter((event) => {
      const old = beforeById.get(event.id);
      return !old ||
        old.date !== event.date ||
        old.startTime !== event.startTime ||
        old.endDate !== event.endDate ||
        old.endTime !== event.endTime ||
        old.status !== event.status ||
        old.locked !== event.locked ||
        old.ticketManaged !== event.ticketManaged;
    })
    .map((event) => event.id);
}

export function formatTicketDateTime(date: string | null, time: string | null) {
  return date && time ? `${date} ${time}` : "待确认";
}

export function formatTicketCutoff(minutes: number | null, label: string) {
  return minutes === null ? `${label}待确认` : `${label}前 ${minutes} 分钟`;
}

export function officialTicketQueryUrl(mode: TicketMode) {
  return mode === "train"
    ? "https://www.12306.cn/index/"
    : "https://www.umetrip.com/";
}
