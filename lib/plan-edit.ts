import {
  nextPlanDate,
  formatPlanDate,
  planEventEnd,
  planEventDurationSeconds,
  type PlanContent,
  type PlanEvent,
  type PlanEventStatus,
} from "./plan";
import { sanitizeTravelerText } from "./content-sanitizer";

export type PlanEventEditInput = {
  eventId: string;
  startTime?: string;
  durationMinutes?: number;
  endTime?: string;
  endDate?: string | null;
  timeEdit?: "preserve" | "start_duration" | "start_end";
  note: string | null;
  locked: boolean;
  status: PlanEventStatus;
  remove: boolean;
};

export class PlanEventLockedError extends Error {
  constructor() {
    super("这项安排已锁定，请先取消锁定，再修改时间、状态、备注或删除。");
    this.name = "PlanEventLockedError";
  }
}

export class PlanEventFixedError extends Error {
  constructor() {
    super("去程和返程是固定交通安排，本阶段不能删除。");
    this.name = "PlanEventFixedError";
  }
}

export class PlanEventEditValidationError extends Error {}

function formatPlanTime(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
}

function sameEventValues(event: PlanEvent, input: PlanEventEditInput) {
  return (
    sameEditableValues(event, input) &&
    (event.locked ?? false) === input.locked
  );
}

function sameEditableValues(event: PlanEvent, input: PlanEventEditInput) {
  const time = resolveTimeEdit(event, input);
  return (
    event.startTime === time.startTime && event.endTime === time.endTime &&
    formatPlanDate(planEventEnd(event)) === time.endDate &&
    (event.note ?? "") === sanitizeTravelerText(input.note ?? "") &&
    (event.status ?? "suggested") === input.status
  );
}

function resolveTimeEdit(event: PlanEvent, input: PlanEventEditInput) {
  const actualDuration = planEventDurationSeconds(event);
  const startTime = input.startTime ?? event.startTime;
  const duration = input.durationMinutes ?? actualDuration / 60;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
    throw new PlanEventEditValidationError("开始时间必须使用 HH:mm。");
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
    throw new PlanEventEditValidationError("事件时长必须在 1 到 1440 分钟之间。");
  }
  // Old clients always sent their duration field, even for note/lock edits.
  // Echoing either the stale stored value or the actual duration is not intent
  // to edit time. New clients send an explicit mode when a time control changes.
  const mode = input.timeEdit ?? (
    input.endTime !== undefined || input.endDate !== undefined ? "start_end" :
      startTime !== event.startTime ||
      (duration * 60 !== event.suggestedDurationSeconds && duration * 60 !== actualDuration)
        ? "start_duration" : "preserve"
  );
  if (mode === "preserve") {
    return { startTime: event.startTime, endTime: event.endTime,
      endDate: formatPlanDate(planEventEnd(event)), suggestedDurationSeconds: actualDuration };
  }
  if (mode === "start_end") {
    const endTime = input.endTime ?? event.endTime;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      throw new PlanEventEditValidationError("结束时间必须使用 HH:mm。");
    }
    const endDate = input.endDate ?? (endTime < startTime ? nextPlanDate(event.date) : event.date);
    const changed = { ...event, startTime, endTime, endDate };
    const seconds = planEventDurationSeconds(changed);
    if (![event.date, nextPlanDate(event.date)].includes(endDate) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) {
      throw new PlanEventEditValidationError("结束时刻必须晚于开始时刻，且时长不超过 24 小时。");
    }
    return { startTime, endTime, endDate, suggestedDurationSeconds: seconds };
  }
  const [hour, minute] = startTime.split(":").map(Number);
  const endMinutes = hour * 60 + minute + duration;
  return { startTime, endTime: formatPlanTime(endMinutes),
    endDate: endMinutes < 1440 ? event.date : nextPlanDate(event.date),
    suggestedDurationSeconds: duration * 60 };
}

export function applyPlanEventEdit(
  plan: PlanContent,
  input: PlanEventEditInput,
): PlanContent {
  const target = plan.events.find((event) => event.id === input.eventId);
  if (!target) {
    throw new Error("没有找到要编辑的日程事件。");
  }

  if ((input.note ?? "").trim().length > 6000) {
    throw new Error("备注最多 6000 个字符。");
  }

  if (target.locked && input.remove) {
    throw new PlanEventLockedError();
  }
  const unlockOnly =
    !input.remove &&
    !input.locked &&
    target.locked &&
    sameEditableValues(target, input);
  if (target.locked && !unlockOnly) {
    throw new PlanEventLockedError();
  }
  if (
    input.remove &&
    (target.type === "departure_transport" ||
      target.type === "return_transport")
  ) {
    throw new PlanEventFixedError();
  }

  if (input.remove) {
    return {
      events: plan.events.filter((event) => event.id !== target.id),
      pendingItems: plan.pendingItems,
    };
  }

  const time = resolveTimeEdit(target, input);
  const cleanedNote = sanitizeTravelerText(input.note);
  const note = cleanedNote ? cleanedNote : null;

  return {
    events: plan.events.map((event) =>
      event.id === target.id
        ? {
            ...event,
            ...time,
            note,
            status: input.status,
            locked: input.locked,
          }
        : event,
    ),
    pendingItems: plan.pendingItems,
  };
}

export function planEventEditHasChanges(
  plan: PlanContent,
  input: PlanEventEditInput,
) {
  const target = plan.events.find((event) => event.id === input.eventId);
  if (!target) {
    return true;
  }
  if (input.remove) {
    return true;
  }
  return !sameEventValues(target, input);
}
