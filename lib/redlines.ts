// All arithmetic uses epoch milliseconds and durations in seconds. No model,
// network, system clock or time-zone-dependent Date getters in this module.
export const REDLINE_ALGORITHM = "redline-15.1";
export type TimingRoute = {
  kind: "fixed" | "timed";
  durationSeconds: number | null;
  status: "verified" | "estimated" | "pending_confirmation" | "unavailable";
  source: string;
  applicableAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  futureCapability: boolean;
  includedTimes: string[];
  details: { label: string; seconds: number | null }[];
};
export type RedlineStep = { id: string; label: string; seconds: number; reason: string };
export type RedlineDeadline = {
  id: string; label: string; at: string | null; afterStep: string;
  nature: "confirmed" | "assumed" | "unknown"; source: string;
};
export type RedlineInput = {
  id: string; eventId: string; direction: "departure" | "return";
  origin: string; destination: string; departureAt: string | null;
  route: TimingRoute; steps: RedlineStep[]; deadlines: RedlineDeadline[];
  buffers: RedlineStep[]; assumptions: string[]; blockers: string[];
  earliestDepartureAt: string | null;
};
export type DeadlineCheck = RedlineDeadline & {
  arrivalAt: string | null; slackSeconds: number | null;
  status: "met" | "insufficient_margin" | "missed" | "unknown";
};
export type ForwardCheck = {
  departureAt: string; route: TimingRoute; routeApplicable: boolean;
  timeline: { id: string; label: string; startAt: string; endAt: string }[];
  routeBreakdown: { label: string; startAt: string; endAt: string }[];
  deadlines: DeadlineCheck[]; status: "feasible" | "insufficient_margin" | "infeasible" | "unknown";
};
export type RedlineResult = {
  input: RedlineInput; algorithm: string; calculationVersion: string; calculatedAt: string;
  suggestedAt: string | null; necessarySeconds: number | null; bufferSeconds: number;
  precision: "verified" | "estimated" | "pending_confirmation";
  reason: string; attempts: { candidateAt: string; check: ForwardCheck }[];
  suggestedCheck: ForwardCheck | null; currentCheck: ForwardCheck;
  conflicts: string[];
};

export const isoAt = (ms: number) => new Date(ms).toISOString();
export const totalBuffer = (input: RedlineInput) => input.buffers.reduce((sum, step) => sum + step.seconds, 0);
function elapsedTo(input: RedlineInput, afterStep: string, route: TimingRoute) {
  if (route.durationSeconds === null) return null;
  if (afterStep === "route") return route.durationSeconds;
  let elapsed = route.durationSeconds;
  for (const step of input.steps) {
    elapsed += step.seconds;
    if (step.id === afterStep) return elapsed;
  }
  return null;
}

export function reverseCandidate(input: RedlineInput, route = input.route): string | null {
  const candidates = input.deadlines.flatMap((deadline) => {
    const seconds = elapsedTo(input, deadline.afterStep, route);
    return deadline.at && seconds !== null
      ? [Date.parse(deadline.at) - (seconds + totalBuffer(input)) * 1000] : [];
  });
  return candidates.length ? isoAt(Math.min(...candidates)) : null;
}

export function routeWindowCovers(route: TimingRoute, departureAt: string) {
  const at = Date.parse(departureAt);
  if (route.kind === "timed" && (!route.validFrom || !route.validUntil)) return false;
  return (!route.validFrom || at >= Date.parse(route.validFrom)) &&
    (!route.validUntil || at <= Date.parse(route.validUntil));
}

export function routeApplies(route: TimingRoute, departureAt: string) {
  return route.status !== "unavailable" && route.durationSeconds !== null && routeWindowCovers(route, departureAt);
}

export function forwardCheck(input: RedlineInput, departureAt: string, route: TimingRoute): ForwardCheck {
  const applicable = routeApplies(route, departureAt);
  const timeline: ForwardCheck["timeline"] = [];
  const routeBreakdown: ForwardCheck["routeBreakdown"] = [];
  let cursor = Date.parse(departureAt);
  if (applicable) {
    // Complete breakdowns annotate the total, never adding to it again.
    if (route.details.length && route.details.every((s) => s.seconds !== null) &&
      route.details.reduce((sum, s) => sum + s.seconds!, 0) === route.durationSeconds) {
      let detailCursor = cursor;
      for (const step of route.details) {
        routeBreakdown.push({ label: step.label, startAt: isoAt(detailCursor), endAt: isoAt(detailCursor + step.seconds! * 1000) });
        detailCursor += step.seconds! * 1000;
      }
    }
    for (const step of [{ id: "route", label: "到达进站口 / 办理区（接驳总耗时）", seconds: route.durationSeconds! }, ...input.steps]) {
      timeline.push({ id: step.id, label: step.label, startAt: isoAt(cursor), endAt: isoAt(cursor + step.seconds * 1000) });
      cursor += step.seconds * 1000;
    }
  }
  const deadlines = input.deadlines.map((deadline): DeadlineCheck => {
    const arrivalAt = timeline.find((step) => step.id === deadline.afterStep)?.endAt ?? null;
    const slack = arrivalAt && deadline.at ? (Date.parse(deadline.at) - Date.parse(arrivalAt)) / 1000 : null;
    return { ...deadline, arrivalAt, slackSeconds: slack,
      status: slack === null ? "unknown" : slack <= 0 ? "missed" : slack < totalBuffer(input) ? "insufficient_margin" : "met" };
  });
  return { departureAt, route, routeApplicable: applicable, timeline, routeBreakdown, deadlines,
    status: route.status === "unavailable" && routeWindowCovers(route, departureAt) || deadlines.some((d) => d.status === "missed") ? "infeasible"
      : !deadlines.length || deadlines.some((d) => d.status === "unknown") ? "unknown"
      : deadlines.some((d) => d.status === "insufficient_margin") ? "insufficient_margin" : "feasible" };
}

export function redlineUrgency(suggestedAt: string | null, now: number) {
  if (!suggestedAt) return { color: "neutral", remainingSeconds: null } as const;
  const remainingSeconds = Math.ceil((Date.parse(suggestedAt) - now) / 1000);
  return { color: remainingSeconds <= 0 ? "red" : remainingSeconds <= 900 ? "orange" : "green", remainingSeconds } as const;
}

export function liveRedlineCheck(result: RedlineResult, now: number, reliable = true): ForwardCheck {
  const route = result.input.route.kind === "fixed" ? result.input.route : result.currentCheck.route;
  const check = forwardCheck(result.input, isoAt(now), route);
  const expiredDeadline = result.input.deadlines.some((d) => d.at && Date.parse(d.at) <= now);
  if (expiredDeadline) return { ...check, status: "infeasible" };
  // A timed result is specific to a queried departure. Do not silently move
  // its waiting time to a new second, or retain yesterday's green status.
  if (!reliable || route.kind === "timed" && now !== Date.parse(result.currentCheck.departureAt)) return { ...check, status: "unknown" };
  return check;
}

export function redlineNeedsAttention(result: RedlineResult, now: number, reliable = true) {
  if (!reliable || result.conflicts.length > 0 || result.precision === "pending_confirmation" ||
      !result.suggestedAt || result.suggestedCheck?.status !== "feasible") return true;
  const urgency = redlineUrgency(result.suggestedAt, now);
  return urgency.color === "orange" || urgency.color === "red" ||
    liveRedlineCheck(result, now, reliable).status !== "feasible";
}

export function formatRedlineTime(at: string | null, relativeDate?: string) {
  if (!at) return "待补资料";
  const local = new Date(Date.parse(at) + 8 * 3600_000).toISOString();
  const date = local.slice(0, 10), time = local.slice(11, 16);
  const previous = relativeDate && new Date(Date.parse(`${relativeDate}T00:00:00Z`) - 86400_000).toISOString().slice(0, 10);
  return `${date === previous ? "前一天 " : ""}${date} ${time}`;
}
