import type { PlanCostItem } from "./budget";
import { formatPlanDate, nextPlanDate, planEventEnd, type PlanEvent } from "./plan";
import { reservationRequirement, type EvidenceField, type ExtractedEvidence } from "./evidence";

export type EvidenceTarget = {
  event: Pick<PlanEvent, "id" | "title" | "locationName" | "date" | "endDate" | "startTime" | "endTime" | "note">;
  price: Pick<PlanCostItem, "category" | "currency" | "unit" | "unitAmountCents" | "unitAmountMaxCents" | "quantity"> | null;
};

export function evidenceTarget(event: PlanEvent, costs: PlanCostItem[]): EvidenceTarget {
  const matches = costs.filter((cost) => cost.linkedEventId === event.id && !cost.eventRemoved);
  const cost = matches.length === 1 ? matches[0] : null;
  return {
    event: { id: event.id, title: event.title, locationName: event.locationName, date: event.date,
      endDate: formatPlanDate(planEventEnd(event)), startTime: event.startTime, endTime: event.endTime, note: event.note },
    price: cost ? { category: cost.category, currency: cost.currency, unit: cost.unit, unitAmountCents: cost.unitAmountCents,
      unitAmountMaxCents: cost.unitAmountMaxCents, quantity: cost.quantity } : null,
  };
}

// Only fields relevant to this evidence belong in the signature. Note/payment
// edits need not invalidate unrelated completed evidence; in-flight evidence is
// always invalidated on version inheritance, independently of this signature.
export function evidenceTargetSignature(target: EvidenceTarget, field: EvidenceField) {
  const event = target.event;
  return JSON.stringify({ id: event.id, title: event.title, location: event.locationName,
    date: event.date, endDate: event.endDate,
    ...(field === "opening_hours" ? { start: event.startTime, end: event.endTime } : {}),
    ...(field === "reservation" ? { requirement: reservationRequirement(event.note ?? "") } : {}),
    ...(field === "price" ? { price: target.price } : {}),
  });
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function subjectMatches(subject: string, target: EvidenceTarget) {
  const name = normalized(subject.replace(/(?:\s+|[-|–—:：])(?:visit|visitor information|official website|opening hours)\s*$/i, "")
    .replace(/(?:官方网站|官网|参观指南|参观须知|开放时间)$/, ""));
  const candidates = [target.event.locationName, target.event.title.replace(/^(?:参观|游览|打卡|visit\s+)/i, "")];
  return candidates.some((candidate) => candidate &&
    (normalized(candidate).length >= 3 || /^[\p{Script=Han}]{2,}$/u.test(normalized(candidate))) &&
    normalized(candidate) === name);
}

const datePattern = "(20\\d{2})[-/年](\\d{1,2})[-/月](\\d{1,2})日?";
const rangePattern = new RegExp(
  `^(?:(information|visitor information|opening hours|reservation policy|ticket prices?|address|本页信息|开放时间|预约规则|票价|地址)[ :：]*)?(?:valid(?:ity)?(?: (?:from|dates?))?|effective(?: from)?|适用(?:日期|时间|期)?|有效(?:期|日期)?)[ :：]*${datePattern}\\s*(?:to|through|until|—|–|至|~|～)\\s*${datePattern}(?:[ .。]*)$`, "gim",
);

export function sourceApplicability(field: EvidenceField, text: string, target?: EvidenceTarget) {
  const unknown = { status: "date_unknown", from: null, until: null,
    reason: "来源未明确说明适用于本次出行的有效日期；发布日期和读取时间不能代替适用期。" } as const;
  if (!target) return unknown;
  const scopes: Record<string, EvidenceField> = {
    "opening hours": "opening_hours", 开放时间: "opening_hours", "reservation policy": "reservation", 预约规则: "reservation",
    "ticket price": "price", "ticket prices": "price", 票价: "price", address: "location", 地址: "location",
  };
  const ranges = [...text.matchAll(rangePattern)].filter((match) => !scopes[(match[1] ?? "").toLowerCase()] || scopes[(match[1] ?? "").toLowerCase()] === field)
    .map((match) => {
      const from = `${match[2]}-${match[3].padStart(2, "0")}-${match[4].padStart(2, "0")}`;
      const until = `${match[5]}-${match[6].padStart(2, "0")}-${match[7].padStart(2, "0")}`;
      return { from, until };
    });
  const distinct = [...new Map(ranges.map((range) => [`${range.from}/${range.until}`, range])).values()];
  if (distinct.length !== 1) return unknown;
  const range = distinct[0];
  const validDate = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!validDate(range.from) || !validDate(range.until) || range.from > range.until) return unknown;
  const from = new Date(`${range.from}T00:00:00+08:00`);
  const until = new Date(new Date(`${nextPlanDate(range.until)}T00:00:00+08:00`).getTime() - 1);
  if (target.event.date < range.from || (target.event.endDate ?? target.event.date) > range.until) {
    return { status: "outside_window", from, until, reason: "来源适用日期不覆盖本次日程，不能用于确认本次出行。" };
  }
  return { status: "applicable", from, until, reason: null };
}

type Evaluation = { status: "verified" | "unverified" | "conflict"; reason: string | null };
const pending = (reason: string): Evaluation => ({ status: "unverified", reason });
const conflict = (reason: string): Evaluation => ({ status: "conflict", reason });

export function evaluateEvidenceField(input: {
  field: EvidenceField; target?: EvidenceTarget; text: string; subject: string; extracted: ExtractedEvidence;
}): Evaluation {
  const { field, target, text, subject, extracted } = input;
  if (!target || !subjectMatches(subject, target)) return pending("来源没有明确对应当前安排的目标对象，不能仅凭查询词或网页可读取来确认。");
  const value = extracted.value.trim();
  if (/\b(?:cafe|restaurant|shop|children|group|special exhibition)\b|餐厅|商店|儿童|团体|特展/i.test(extracted.quote)) {
    return pending("字段包含其他对象或限定人群，无法确定适用于当前安排。");
  }
  if (field === "opening_hours") {
    const weekday = new Date(`${target.event.date}T00:00:00Z`).getUTCDay();
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const chinese = ["日", "一", "二", "三", "四", "五", "六"];
    const closure = new RegExp(`\\b(?:closed|not open)\\s+(?:on\\s+)?(?:every\\s+)?${names[weekday]}s?\\b|\\b${names[weekday]}s?\\s*(?:are\\s*)?[:：-]?\\s*(?:closed|not open)|(?:每)?(?:周|星期)${chinese[weekday]}[^。\\n]{0,12}(?:闭馆|闭园|不开放)`, "i");
    if (/\bexcept\b|节假日|除外|例外|通常|normally|not closed/i.test(text)) return pending("开放规则包含例外或含糊说明，无法确认当天是否适用。");
    if (closure.test(text) || /temporarily closed|closed until further notice|临时闭馆|暂停开放/i.test(text)) {
      return conflict("官方开放规则表明本次到访日闭馆或暂停开放，与安排冲突。");
    }
    if (/\bnot\b|\bnever\b|\bno entry\b|n't|不|尚未|并非/i.test(extracted.quote)) {
      return pending("开放规则含未能可靠解释的否定说明，需要人工复核。");
    }
    const dayRange = extracted.quote.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*(?:to|through|[-–—])\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i);
    const cnRange = extracted.quote.match(/(?:周|星期)([一二三四五六日天])\s*(?:至|到|[-–—])\s*(?:周|星期)?([一二三四五六日天])/);
    if (dayRange || cnRange) {
      const first = dayRange ? names.findIndex((name) => name.toLowerCase() === dayRange[1].toLowerCase()) : chinese.indexOf(cnRange![1].replace("天", "日"));
      const last = dayRange ? names.findIndex((name) => name.toLowerCase() === dayRange[2].toLowerCase()) : chinese.indexOf(cnRange![2].replace("天", "日"));
      const allowed: number[] = [first];
      while (allowed.at(-1) !== last && allowed.length < 7) allowed.push((allowed.at(-1)! + 1) % 7);
      if (!allowed.includes(weekday)) return conflict("本次到访日不在来源明确列出的开放日内。");
    } else if (!/\bdaily\b|\bevery day\b|每日|每天/i.test(extracted.quote)) {
      return pending("来源没有明确覆盖到访日的开放规则。");
    }
    if (!extracted.matched || !extracted.hours) return pending("已读取页面，但没有唯一、明确的开放时段可与日程比较。");
    const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
    const start = minutes(target.event.startTime);
    const end = minutes(target.event.endTime) + ((target.event.endDate ?? target.event.date) !== target.event.date ? 1440 : 0);
    const open = extracted.hours.start;
    const close = extracted.hours.end + (extracted.hours.end < open ? 1440 : 0);
    const lastEntry = text.match(/(?:last entry|停止入馆|停止入场)[^\d]{0,12}((?:[01]?\d|2[0-3]):[0-5]\d)/i);
    if (start < open || end > close || (lastEntry && start >= minutes(lastEntry[1]))) {
      return conflict("当前安排的起止时刻不符合来源的开放或停止入场时间。");
    }
  } else {
    if (!extracted.matched || !value) return pending("已读取页面，但没有找到唯一、明确的对应字段值。");
    if (field === "location") {
      const expected = target.event.locationName?.trim();
      if (!expected) return pending("当前安排没有可比较的位置值，不能把空值视为匹配。");
      if (normalized(expected) !== normalized(value)) {
        const address = (input: string) => /\d/.test(input) && /road|street|avenue|路|街|号/i.test(input);
        return address(expected) && address(value) ? conflict("来源地址与当前安排的位置不一致。") : pending("来源位置与当前安排未能精确对应，不能以名称相似代替确认。");
      }
    } else if (field === "reservation") {
      if (reservationRequirement(text) !== value) return pending("页面其他预约说明包含条件或不明确表达，不能仅截取一句话确认。");
      const expected = reservationRequirement(target.event.note ?? "");
      if (!expected) return pending("来源已提取预约规则，但当前安排没有明确的预约要求可供比较；这不代表已经预约。");
      if (expected !== value) return conflict("来源预约要求与当前安排的说明相反，需要重新确认。");
    } else if (field === "price") {
      const cost = target.price;
      const price = extracted.price;
      if (!cost || cost.unitAmountCents === null || !price) return pending("当前计划没有唯一、明确的对应费用金额可供比较。");
      if (cost.category !== "ticket" || !/admission|ticket|门票|票价|免费参观/i.test(extracted.quote)) {
        return pending("来源价格未能明确对应当前费用项目；仅凭金额相同不能确认。");
      }
      if (cost.currency !== "CNY" || (price.cents !== 0 && (!price.unit || cost.unit !== price.unit))) {
        return pending("来源价格与计划费用的币种或计价口径不能可靠对应。");
      }
      if (cost.unitAmountMaxCents !== null && cost.unitAmountMaxCents !== cost.unitAmountCents) return pending("计划金额仍是区间，不能用单一价格确认整个区间。");
      if (cost.unitAmountCents !== price.cents) return conflict("来源价格与当前计划对应费用金额不一致。");
    }
  }
  return { status: "verified", reason: null };
}
