import { z } from "zod";
import { planEventEnd, planEventStart, type PlanEvent } from "./plan";

export class ExecutionError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = "ExecutionError"; }
}
const id = z.string().min(1).max(100);
const instant = z.string().datetime({ offset: true });
const locationSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("manual"), label: z.string().trim().min(1).max(120), eventId: id.nullable(), recordedAt: instant }).strict(),
  z.object({ source: z.literal("geolocation"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(1000000), recordedAt: instant }).strict(),
]);
export const executionSchema = z.object({
  startedAt: instant.nullable(), endedAt: instant.nullable(), currentEventId: id.nullable(),
  items: z.array(z.object({ eventId: id, title: z.string(), locationName: z.string(), arrivedAt: instant.nullable(), completedAt: instant.nullable() }).strict()).max(2000),
  location: locationSchema.nullable(),
}).strict();
export type ExecutionProgress = z.infer<typeof executionSchema>;
export type ExecutionView = ExecutionProgress & { revision: number; planVersion: number; updatedAt: string | null };
export const emptyExecution = (): ExecutionProgress => ({ startedAt: null, endedAt: null, currentEventId: null, items: [], location: null });
export function parseExecution(payload?: string | null): ExecutionProgress { return payload ? executionSchema.parse(JSON.parse(payload)) : emptyExecution(); }
export const executionWriteSchema = z.object({
  expectedRevision: z.number().int().nonnegative(), expectedPlanVersion: z.number().int().positive(),
  change: z.discriminatedUnion("action", [
    z.object({ action: z.literal("start"), eventId: id }).strict(),
    z.object({ action: z.enum(["select", "arrive", "complete"]), eventId: id }).strict(),
    z.object({ action: z.literal("manual_location"), label: z.string().trim().min(1).max(120) }).strict(),
    z.object({ action: z.literal("locate"), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().min(0).max(1000000) }).strict(),
    z.object({ action: z.literal("clear_location") }).strict(),
  ]),
}).strict();
export type ExecutionChange = z.infer<typeof executionWriteSchema>["change"];
export const orderedExecutionEvents = (events: PlanEvent[]) => [...events].sort((a, b) => planEventStart(a).getTime() - planEventStart(b).getTime() || (a.order ?? 0) - (b.order ?? 0));
export function executionProtectedIds(state: ExecutionProgress) {
  return new Set([state.currentEventId, ...state.items.filter((i) => i.arrivedAt || i.completedAt).map((i) => i.eventId),
    state.location?.source === "manual" ? state.location.eventId : null].filter((v): v is string => Boolean(v)));
}
export function executionEventChangeConflict(before: PlanEvent[], after: PlanEvent[], state: ExecutionProgress) {
  const protectedIds = executionProtectedIds(state);
  for (const event of before.filter((item) => protectedIds.has(item.id))) {
    const next = after.find((item) => item.id === event.id);
    // Notes, locks and confirmation labels may still be corrected. A visit's
    // identity and planned timing cannot acquire another visit's actual record.
    if (!next || ["type", "title", "locationName", "placeId", "dayNumber"].some((key) =>
      (event[key as keyof PlanEvent] ?? null) !== (next[key as keyof PlanEvent] ?? null)) ||
      planEventStart(event).getTime() !== planEventStart(next).getTime() ||
      planEventEnd(event).getTime() !== planEventEnd(next).getTime() ||
      JSON.stringify(event.accommodationSelection) !== JSON.stringify(next.accommodationSelection)) {
      return `“${event.title}”已选为当前步骤、已到达或已完成，不能删除或改写活动身份、地点和计划时刻。实际进度已保留。`;
    }
  }
  return null;
}
export function applyExecutionChange(state: ExecutionProgress, events: PlanEvent[], change: ExecutionChange, now: string): ExecutionProgress {
  const result = structuredClone(state);
  if (change.action === "clear_location") { result.location = null; return result; }
  if (change.action === "manual_location") { result.location = { source: "manual", label: change.label, eventId: null, recordedAt: now }; return result; }
  if (change.action === "locate") {
    result.location = { source: "geolocation", latitude: change.latitude, longitude: change.longitude, accuracy: change.accuracy, recordedAt: now }; return result;
  }
  const event = events.find((e) => e.id === change.eventId);
  if (!event) throw new ExecutionError("这一步已不在当前计划中，请重新读取。");
  if (change.action === "start") {
    if (result.startedAt) throw new ExecutionError("旅行已经开始，请重新读取进度。");
    result.startedAt = now; result.currentEventId = event.id; return result;
  }
  if (!result.startedAt) throw new ExecutionError("请先开始旅行。");
  if (result.endedAt) throw new ExecutionError("全部活动已经完成，进度已保留。");
  if (change.action === "select") { result.currentEventId = event.id; return result; }
  if (result.currentEventId !== event.id) throw new ExecutionError("当前步骤已变化，请先选择要记录的步骤。");
  let item = result.items.find((i) => i.eventId === event.id);
  if (!item) { item = { eventId: event.id, title: event.title, locationName: event.locationName ?? event.title, arrivedAt: null, completedAt: null }; result.items.push(item); }
  if (item.completedAt) throw new ExecutionError("这一步已完成，请重新读取进度。");
  if (change.action === "arrive") {
    item.arrivedAt ??= now;
    result.location = { source: "manual", label: event.locationName ?? event.title, eventId: event.id, recordedAt: now };
  } else {
    item.completedAt = now;
    const done = new Set(result.items.filter((i) => i.completedAt).map((i) => i.eventId));
    const ordered = orderedExecutionEvents(events), following = ordered.slice(ordered.findIndex((e) => e.id === event.id) + 1);
    result.currentEventId = (following.find((e) => !done.has(e.id)) ?? ordered.find((e) => !done.has(e.id)))?.id ?? null;
    if (!result.currentEventId) result.endedAt = now;
  }
  return executionSchema.parse(result);
}

export function executionTiming(event: PlanEvent, now: number) {
  const start = planEventStart(event).getTime(), end = planEventEnd(event).getTime();
  if (now < start) return { phase: "future" as const, seconds: Math.ceil((start - now) / 1000) };
  if (now < end) return { phase: "ongoing" as const, seconds: Math.ceil((end - now) / 1000) };
  return { phase: "expired" as const, seconds: Math.floor((now - end) / 1000) };
}
export function executionSummary(events: PlanEvent[], state: ExecutionProgress, now: number) {
  const ordered = orderedExecutionEvents(events), completed = new Set(state.items.filter((i) => i.completedAt).map((i) => i.eventId));
  const remaining = ordered.filter((e) => !completed.has(e.id));
  // Only suggest by time before the user starts. Time never advances actual progress.
  const suggested = ordered.find((e) => planEventEnd(e).getTime() > now) ?? ordered[0] ?? null;
  const current = state.startedAt ? ordered.find((e) => e.id === state.currentEventId) ?? remaining[0] ?? null : suggested;
  const following = current ? ordered.slice(ordered.findIndex((e) => e.id === current.id) + 1) : remaining;
  const next = following.find((e) => !completed.has(e.id)) ?? null;
  const earlierIncompleteCount = current ? remaining.filter((e) => planEventStart(e).getTime() < planEventStart(current).getTime()).length : 0;
  const estimated = ordered.find((e) => planEventStart(e).getTime() <= now && planEventEnd(e).getTime() > now);
  return { current, next, suggested, earlierIncompleteCount, completedCount: ordered.filter((e) => completed.has(e.id)).length,
    status: state.endedAt ? "ended" as const : state.startedAt ? "active" as const : "not_started" as const,
    scheduleEnded: Boolean(ordered.length && ordered.every((e) => planEventEnd(e).getTime() <= now)),
    estimatedLocation: estimated?.locationName ?? null };
}
