import { derivePlanCosts, type PlanCostItem } from "./budget";
import type { PlanEvent } from "./plan";
import type { RequestSnapshot } from "./trip-request";

const money = "(\\d+(?:\\.\\d{1,2})?)\\s*(?:[-—–~～至到]\\s*(\\d+(?:\\.\\d{1,2})?))?\\s*元";
const cents = (value: string) => Math.round(Number(value) * 100);
type NarrativeRate = { min: number; max: number | null; perPerson: boolean; clause: string };

function moneyMentions(clause: string) {
  return [...clause.matchAll(new RegExp(money, "g"))].flatMap((match) => {
    const min = cents(match[1]), max = match[2] ? cents(match[2]) : null;
    if (max !== null && max < min) return [];
    return [{ min, max, before: clause.slice(0, match.index), after: clause.slice(match.index + match[0].length), clause }];
  });
}

function nightlyRate(note: string): NarrativeRate | undefined {
  for (const clause of note.split(/[。；;，,\n]/)) {
    for (const rate of moneyMentions(clause)) {
      const before = rate.before.slice(-24), after = rate.after.slice(0, 14);
      if (/人均|每人/.test(before) || /^\s*(?:\/|／)\s*人/.test(after)) continue;
      if (/^\s*(?:\/|／|每)?\s*(?:(?:间|房)[·/／]?)?晚/.test(after) ||
        /(?:每间每晚|每房每晚|每晚|一晚|每间夜|间夜)[^元\d]{0,12}$/.test(before)) return { ...rate, perPerson: false };
    }
  }
}

function taxiRate(note: string, event: Pick<PlanEvent, "type" | "title">): NarrativeRate | undefined {
  // Commas commonly separate a route, its duration and its group fare. Keep
  // the sentence together, but let the nearest cost/activity label decide
  // whether each price belongs to transport, meals, tickets or a room.
  const clauses = note.split(/[。；;\n]/);
  const localContext = event.type === "local_transport" && /打车|出租车|网约车|公交|接驳|乘车|交通|返回|前往/.test(event.title);
  for (const clause of clauses) {
    for (const rate of moneyMentions(clause)) {
      const label = [...rate.before.matchAll(/打车|出租车|网约车|接驳车|车费|交通费/g)].at(-1);
      const otherPrice = [...rate.before.matchAll(/早餐|午餐|晚餐|午饭|晚饭|餐费|门票|房费|小吃|用餐|餐饮|面线糊|姜母鸭|四果汤|后吃|后喝/g)].at(-1);
      if (otherPrice && (!label || otherPrice.index > label.index)) continue;
      if (!label && !localContext) continue;
      const between = label ? rate.before.slice(label.index + label[0].length) : rate.before;
      return { ...rate, perPerson: /人均|每人/.test(between) || /^\s*(?:\/|／)\s*人/.test(rate.after) };
    }
  }
}

function transferAnchors(description: string) {
  const hubs = [...description.matchAll(/[\u4e00-\u9fffA-Za-z\d]{2,16}?(?:站|机场|码头)/g)]
    .map((match) => match[0].replace(/^.*(?:到达|抵达|从|在|到|至)/, ""));
  const target = description.match(/(?:打车|出租车|网约车|接驳车).{0,6}?(?:至|到|前往)([^约预计需\d，。；]{2,16})/)?.[1]?.trim().replace(/(?:附近|一带|周边|片区|区域)$/, "");
  return [...new Set([...hubs, ...(target && !/^(?:酒店|市区|车站|机场)$/.test(target) ? [target] : [])])];
}

function sameTransferLeg(main: PlanEvent, local: PlanEvent, description: string) {
  if (local.type !== "local_transport" || local.id === main.id) return false;
  const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+08:00`);
  const mainStart = at(main.date, main.startTime), localStart = at(local.date, local.startTime);
  const mainEnd = at(main.endDate ?? main.date, main.endTime) + (!main.endDate && main.endTime < main.startTime ? 86_400_000 : 0);
  const localEnd = at(local.endDate ?? local.date, local.endTime) + (!local.endDate && local.endTime < local.startTime ? 86_400_000 : 0);
  const isNearby = main.type === "departure_transport" ? localStart >= mainEnd && localStart - mainEnd <= 3 * 3_600_000
    : localEnd <= mainStart && mainStart - localEnd <= (main.type === "return_transport" ? 6 : 3) * 3_600_000 ||
      main.type !== "return_transport" && localStart >= mainStart && localEnd <= mainEnd;
  if (!isNearby) return false;
  const anchors = transferAnchors(description);
  const localText = `${local.title} ${local.locationName ?? ""} ${local.note ?? ""}`;
  return anchors.length > 0 && anchors.every((anchor) => localText.includes(anchor));
}

/** Reconcile explicit estimates only on fresh AI drafts; never rewrite paid/user costs. */
export function deriveGeneratedPlanCosts(events: PlanEvent[], snapshot: RequestSnapshot): PlanCostItem[] {
  const costs = derivePlanCosts(events);
  const narrativeTransfers: { anchors: string; at: number }[] = [];
  for (const event of events) {
    const cost = costs.find((item) => item.linkedEventId === event.id)!;
    const note = event.note ?? "";
    if (event.costStatus === "user_confirmed" || event.locked || event.status === "confirmed") continue;
    if (event.type === "accommodation") {
      const rate = nightlyRate(note);
      if (rate) {
        cost.unit = "per_room_per_night";
        cost.unitAmountCents = rate.min;
        cost.unitAmountMaxCents = rate.max;
        cost.nightCount = 1;
        cost.roomCount = Math.ceil((snapshot.travelerCount ?? 1) / 2);
        cost.note = "按正文每间每晚参考价格计算，当晚计一次。";
      }
    } else if (event.type === "local_transport") {
      const rate = taxiRate(note, event);
      if (rate) {
        cost.unit = rate.perPerson ? "per_person" : "one_time";
        cost.unitAmountCents = rate.min;
        cost.unitAmountMaxCents = rate.max;
        cost.note = rate.perPerson ? "正文所列每人接驳参考费用，按出行人数计算。" : "正文所列整车参考费用。";
      }
    }
    if (event.type !== "local_transport") {
      const transfer = taxiRate(note, event);
      if (!transfer || /(?:含|包含|含有)(?:当地|市内|到站)?(?:接驳|打车)/.test(note.replace(/(?:不|未)(?:包含|含有|含)/g, "另计"))) continue;
      const relevant = events.some((other) => sameTransferLeg(event, other, transfer.clause));
      if (relevant) continue;
      const anchors = transferAnchors(transfer.clause);
      const at = Date.parse(`${event.type === "departure_transport" ? event.endDate ?? event.date : event.date}T${event.type === "departure_transport" ? event.endTime : event.startTime}:00+08:00`);
      const identity = anchors.join("→");
      if (anchors.length >= 2 && narrativeTransfers.some((existing) => existing.anchors === identity && Math.abs(existing.at - at) <= 3 * 3_600_000)) continue;
      narrativeTransfers.push({ anchors: identity, at });
      const transferCost: PlanCostItem = { ...cost, id: `cost-transfer-${event.id}`.slice(0, 96), category: "local_transport", unit: transfer.perPerson ? "per_person" : "one_time", quantity: null,
        unitAmountCents: transfer.min, unitAmountMaxCents: transfer.max,
        transferSide: event.type === "departure_transport" ? "egress" : "access", note: `正文接驳费用：${transfer.clause}`.slice(0, 240) };
      delete transferCost.roomCount;
      delete transferCost.nightCount;
      delete transferCost.dinerCount;
      costs.push(transferCost);
    }
  }
  return costs;
}
