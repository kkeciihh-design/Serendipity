import {
  nextPlanDate,
  type AIPlanOutput,
  type PlanEvent,
  type PlanEventStatus,
} from "./plan";

export type PlanEventEditInput = {
  eventId: string;
  startTime: string;
  durationMinutes: number;
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

function formatPlanTime(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${`${hour}`.padStart(2, "0")}:${`${minute}`.padStart(2, "0")}`;
}

function sameEventValues(event: PlanEvent, input: PlanEventEditInput) {
  return (
    event.startTime === input.startTime &&
    event.suggestedDurationSeconds === input.durationMinutes * 60 &&
    (event.note ?? "") === (input.note ?? "").trim() &&
    (event.status ?? "suggested") === input.status &&
    (event.locked ?? false) === input.locked
  );
}

function sameEditableValues(event: PlanEvent, input: PlanEventEditInput) {
  return (
    event.startTime === input.startTime &&
    event.suggestedDurationSeconds === input.durationMinutes * 60 &&
    (event.note ?? "") === (input.note ?? "").trim() &&
    (event.status ?? "suggested") === input.status
  );
}

export function applyPlanEventEdit(
  plan: AIPlanOutput,
  input: PlanEventEditInput,
): AIPlanOutput {
  const target = plan.events.find((event) => event.id === input.eventId);
  if (!target) {
    throw new Error("没有找到要编辑的日程事件。");
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    throw new Error("开始时间必须使用 HH:mm。");
  }
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 1 ||
    input.durationMinutes > 1440
  ) {
    throw new Error("事件时长必须在 1 到 1440 分钟之间。");
  }
  if ((input.note ?? "").trim().length > 240) {
    throw new Error("备注最多 240 个字符。");
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

  const [startHour, startMinute] = input.startTime.split(":").map(Number);
  const endTotalMinutes = startHour * 60 + startMinute + input.durationMinutes;
  const endDate =
    endTotalMinutes < 1440 ? target.date : nextPlanDate(target.date);
  const endTime = formatPlanTime(endTotalMinutes);
  const note = input.note?.trim() ? input.note.trim() : null;

  return {
    events: plan.events.map((event) =>
      event.id === target.id
        ? {
            ...event,
            startTime: input.startTime,
            endTime,
            endDate,
            suggestedDurationSeconds: input.durationMinutes * 60,
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
  plan: AIPlanOutput,
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
