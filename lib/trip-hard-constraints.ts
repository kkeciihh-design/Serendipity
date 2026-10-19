import type { PlanEvent } from "./plan";
import type { RequestSnapshot } from "./trip-request";

export type TripHardTimeConstraint = {
  kind: "return_departure" | "outbound_departure" | "outbound_arrival";
  date: string;
  time: string;
  label: string;
};

const numerals: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4 };
const actionLabels = { return_departure: "返程发车", outbound_arrival: "去程到达", outbound_departure: "去程出发" } as const;

function constraint(kind: TripHardTimeConstraint["kind"], date: string, time: string): TripHardTimeConstraint {
  return { kind, date, time, label: `${time} ${actionLabels[kind]} · 硬时间` };
}

function calendarDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Only explicit transport times are hard facts; opening hours and vague wishes aren't. */
export function getTripHardTimeConstraints(snapshot: RequestSnapshot | null | undefined, originalRequest?: string): TripHardTimeConstraint[] {
  if (!snapshot?.startDate || !snapshot.endDate) return [];
  const source = originalRequest === undefined ? snapshot.constraints : [originalRequest];
  const constraints: TripHardTimeConstraint[] = [];
  // Canonical facts were extracted from the user's original request. Prefer
  // them to AI paraphrases, and retain their explicit date instead of assuming
  // every return is on the final date.
  const canonical = source.flatMap((text) => [...text.matchAll(/(\d{4}-\d{2}-\d{2})\s+([0-2]\d:[0-5]\d)\s+(返程发车|去程到达|去程出发)[，,]\s*硬时间不可推迟/g)].flatMap((match) => {
    if (!calendarDate(match[1]) || Number(match[2].slice(0, 2)) > 23) return [];
    const kind = (Object.keys(actionLabels) as TripHardTimeConstraint["kind"][]).find((key) => actionLabels[key] === match[3])!;
    return [constraint(kind, match[1], match[2])];
  }));
  const destination = (snapshot.destination ?? "").replace(/市$/, "");
  const destinations = [destination, ...(destination.length >= 4 ? [destination.slice(-2)] : [])].filter(Boolean);
  for (const text of source) {
    let direction: "outbound" | "return" | null = null;
    for (const clause of text.split(/[。；;，,\n]/)) {
      const times = [...clause.matchAll(/(?:上午|早上|凌晨|中午|下午|晚上|傍晚)?\s*(\d{1,2})(?:[:：](\d{2})|点(?:(\d{1,2})分?|半)?)/g)];
      for (const [index, match] of times.entries()) {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length, times[index + 1]?.index).split(/第\s*[1-4一二三四]\s*天/)[0];
        if (/(?:左右|前后|大约)/.test(after.slice(0, 5)) || /(?:大约|大概|预计|约)\s*$/.test(before) || /^\s*(?:前|后|之前|之后)/.test(after)) continue;
        let hour = Number(match[1]);
        const minute = match[0].endsWith("半") ? 30 : Number(match[2] ?? match[3] ?? 0);
        if (/下午|晚上/.test(match[0]) && hour < 12) hour += 12;
        if (hour > 23 || minute > 59) continue;
        const labelsBefore = [...before.matchAll(/去程|返程|回程/g)];
        if (labelsBefore.length) direction = labelsBefore.at(-1)![0] === "去程" ? "outbound" : "return";
        const nearBefore = before.slice(times[index - 1] ? times[index - 1].index + times[index - 1][0].length : 0);
        const actionPattern = /回到|返回到|到达|抵达|到站|出发|发车|起飞|返程|回程|返回|回[\u4e00-\u9fff]{1,6}|去程/g;
        const nextAction = [...after.matchAll(actionPattern)][0];
        const priorActions = [...nearBefore.matchAll(actionPattern)];
        const priorAction = index === 0 || priorActions.length > 1 ? priorActions.at(-1) : undefined;
        const action = nextAction?.[0] ?? priorAction?.[0] ?? "";
        const arrivalAtDestination = destinations.some((place) => after.includes(`到${place}`) || after.includes(`到达${place}`) || after.includes(`抵达${place}`));
        if (!action && !arrivalAtDestination) continue;
        const isArrival = /^(?:回到|返回到|到达|抵达|到站)$/.test(action) || !action && arrivalAtDestination;
        const isReturn = /^(?:返程|回程|返回|回)/.test(action) || direction === "return";
        const explicitDays = [...before.matchAll(/第\s*([1-4一二三四])\s*天/g)];
        const explicitDay = explicitDays.at(-1);
        const firstDay = explicitDay && (numerals[explicitDay[1]] ?? Number(explicitDay[1])) === 1;
        // A return-station arrival/check-in deadline is not the train's
        // departure. Likewise, reaching a hotel or attraction is not intercity arrival.
        if (isArrival && (isReturn || /^(?:回到|返回到)/.test(action) ||
          !arrivalAtDestination && direction !== "outbound" && !firstDay || /到(?:达)?[^，。]{0,8}(?:酒店|寺|博物馆|景区)/.test(after))) continue;
        if (isArrival && /到(?:达)?[^，。]{0,8}(?:站|机场|码头)/.test(after) && explicitDay && (numerals[explicitDay[1]] ?? Number(explicitDay[1])) > 1) continue;
        if (!isArrival && !isReturn && !/^(?:出发|发车|起飞|去程)$/.test(action)) continue;
        if (!isArrival && !isReturn && /酒店|寺|博物馆|景区/.test(after) && !/高铁|火车|航班|飞机|动车/.test(nearBefore + after)) continue;
        const kind = isReturn ? "return_departure" : isArrival ? "outbound_arrival" : "outbound_departure";
        if (isReturn) direction = "return";
        let date = kind === "return_departure" ? snapshot.endDate : snapshot.startDate;
        if (explicitDay) {
          const day = numerals[explicitDay[1]] ?? Number(explicitDay[1]);
          date = new Date(Date.parse(`${snapshot.startDate}T00:00:00Z`) + (day - 1) * 86400000).toISOString().slice(0, 10);
        }
        const explicitDate = [...before.matchAll(/\d{4}-\d{2}-\d{2}/g)].at(-1)?.[0];
        if (explicitDate && calendarDate(explicitDate)) date = explicitDate;
        const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        if (!canonical.some((item) => item.kind === kind)) constraints.push(constraint(kind, date, time));
      }
    }
  }
  const all = [...canonical, ...constraints];
  return all.filter((item, index) => all.findIndex((other) => other.kind === item.kind && other.date === item.date && other.time === item.time) === index);
}

export function preserveExplicitTransportTimes(snapshot: RequestSnapshot, originalRequest: string): RequestSnapshot {
  const times = getTripHardTimeConstraints(snapshot, originalRequest);
  if (!times.length) return snapshot;
  const constraints = snapshot.constraints.map((text) => times.reduce((copy, item) => copy.replace(new RegExp(`${item.time}\\s*(?:左右|前后)`, "g"), item.time), text));
  for (const item of times) {
    const action = item.kind === "return_departure" ? "返程发车" : item.kind === "outbound_arrival" ? "去程到达" : "去程出发";
    const fact = `${item.date} ${item.time} ${action}，硬时间不可推迟`;
    if (!constraints.includes(fact)) constraints.unshift(fact);
  }
  return { ...snapshot, constraints: constraints.slice(0, 12), fieldSources: { ...snapshot.fieldSources, constraints: "program_derived" } };
}

export function validateTripHardTimes(events: PlanEvent[], snapshot: RequestSnapshot): string[] {
  return getTripHardTimeConstraints(snapshot).flatMap((constraint) => {
    const event = events.find((item) => item.type === (constraint.kind === "return_departure" ? "return_transport" : "departure_transport"));
    if (!event || event.ticketTimingPending) return [];
    const time = constraint.kind === "outbound_arrival" ? event.endTime : event.startTime;
    const date = constraint.kind === "outbound_arrival" ? event.endDate ?? event.date : event.date;
    return time === constraint.time && date === constraint.date ? [] : [`${constraint.date} ${constraint.label}，交通节点必须保留明确时刻，当前为 ${date} ${time}。`];
  });
}

export function exactTransportTimeCopy(text: string, snapshot: RequestSnapshot) {
  return getTripHardTimeConstraints(snapshot).reduce((copy, item) => copy.replace(new RegExp(`${item.time}\\s*(?:左右|前后)`, "g"), item.time), text);
}
