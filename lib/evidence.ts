import { z } from "zod";

export const evidenceTargetSchema = z.enum(["event"]);
export const evidenceFieldSchema = z.enum([
  "opening_hours",
  "reservation",
  "price",
  "location",
]);

export type EvidenceField = z.infer<typeof evidenceFieldSchema>;
export type EvidenceTargetType = z.infer<typeof evidenceTargetSchema>;

export const evidenceStatusSchema = z.enum([
  "verified",
  "unverified",
  "conflict",
]);

export type EvidenceStoredStatus = z.infer<typeof evidenceStatusSchema>;

export type EvidenceEffectiveStatus =
  | "verified"
  | "pending"
  | "conflict"
  | "stale";

export const CURRENT_EVIDENCE_EVALUATION_VERSION = 1;

export type EvidenceFactClient = {
  id: string;
  planVersionId: string;
  targetType: "event";
  targetId: string;
  field: EvidenceField;
  status: EvidenceStoredStatus;
  evaluationVersion?: number;
  effectiveStatus: EvidenceEffectiveStatus;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublisher: string;
  sourcePublishedAt: string | null;
  sourceDateStatus: string | null;
  extractedValue: string;
  searchProvider: string;
  searchQuery: string;
  retrievedAt: string;
  applicableFrom: string | null;
  applicableUntil: string | null;
  lastRefreshAt: string | null;
  lastRefreshStatus: string | null;
  lastRefreshError: string | null;
  contentQuote: string;
  conflictReason: string | null;
};

export const evidenceFieldLabels: Record<EvidenceField, string> = {
  opening_hours: "开放时间",
  reservation: "预约要求",
  price: "价格",
  location: "位置",
};

export const evidenceStatusLabels: Record<EvidenceEffectiveStatus, string> = {
  verified: "已核验",
  pending: "建议确认",
  conflict: "来源冲突",
  stale: "需复核",
};

export function effectiveEvidenceStatus(
  fact: Pick<
    EvidenceFactClient,
    "status" | "applicableUntil" | "lastRefreshStatus"
  > & Partial<Pick<EvidenceFactClient, "field" | "evaluationVersion" | "applicableFrom" | "sourceDateStatus" | "extractedValue" | "contentQuote" | "sourceUrl">>,
  now = new Date(),
): EvidenceEffectiveStatus {
  if (fact.status === "conflict") {
    return "conflict";
  }
  if (fact.status === "verified" && fact.field === "opening_hours" &&
    (fact.evaluationVersion ?? 0) < CURRENT_EVIDENCE_EVALUATION_VERSION) {
    return "stale";
  }
  if (["failed", "refreshing", "needs_review"].includes(fact.lastRefreshStatus ?? "")) {
    return "stale";
  }
  if (["outside_window", "outdated_for_trip", "published_after_trip"].includes(fact.sourceDateStatus ?? "")) return "stale";
  if (
    fact.status === "verified" &&
    fact.applicableUntil &&
    now.getTime() > new Date(fact.applicableUntil).getTime()
  ) {
    return "stale";
  }
  // Old records that only proved a page was read do not acquire the stronger
  // meaning retroactively. Downgrade on read without rewriting history.
  if (fact.status !== "verified" || fact.sourceDateStatus !== "applicable" ||
    !fact.extractedValue?.trim() || !fact.contentQuote?.trim() || !fact.sourceUrl ||
    !fact.applicableFrom || !fact.applicableUntil ||
    !Number.isFinite(new Date(fact.applicableFrom).getTime()) ||
    !Number.isFinite(new Date(fact.applicableUntil).getTime()) ||
    new Date(fact.applicableFrom).getTime() > new Date(fact.applicableUntil).getTime()) return "pending";
  return "verified";
}

export function summarizeEventEvidence(facts: EvidenceFactClient[]) {
  const statuses = evidenceFieldSchema.options.map((field) => {
    const fact = facts.find((item) => item.field === field);
    return fact ? effectiveEvidenceStatus(fact) : "pending";
  });
  const verifiedCount = statuses.filter((status) => status === "verified").length;
  if (statuses.includes("conflict")) return { status: "conflict" as const, label: "来源有冲突", verifiedCount };
  if (statuses.includes("stale")) return { status: "stale" as const, label: "来源需复核", verifiedCount };
  if (verifiedCount === statuses.length) return { status: "verified" as const, label: "4 项来源字段已核验", verifiedCount };
  return { status: "pending" as const, label: verifiedCount ? `${verifiedCount}/4 项字段已核验，其余待确认` : "来源待确认", verifiedCount };
}

export function normalizeOfficialHost(input: string) {
  let url: URL;
  try {
    if (/[\\\s]/.test(input.trim())) throw new Error();
    url = new URL(input.includes("://") ? input.trim() : `https://${input.trim()}`);
  } catch {
    throw new Error("官方域名格式不正确。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
    url.port || url.pathname !== "/" || url.search || url.hash ||
    !/\.[a-z]{2,}$/.test(url.hostname) ||
    url.hostname.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("官方域名格式不正确。");
  }
  return url.hostname;
}

export function isOfficialUrl(url: URL, officialHost: string) {
  return (
    url.hostname === officialHost ||
    url.hostname.endsWith(`.${officialHost}`)
  );
}

export function decodeHtmlEntities(input: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(
      /&([a-z]+);/gi,
      (_, entity: string) => namedEntities[entity.toLowerCase()] ?? " ",
    );
}

export function htmlToPlainText(input: string) {
  return decodeHtmlEntities(
    input
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<\/?(?:p|div|h[1-6]|li|tr|section|article|br)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}

export function extractPageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToPlainText(match[1]).slice(0, 180) : "";
}

export function extractSourcePublishedAt(html: string) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) {
      continue;
    }
    const date = new Date(match[1]);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

export function reservationRequirement(text: string): "required" | "not_required" | null {
  if (/\b(?:may|might|usually|sometimes|except|only|unless|if|when|not always|not true|not necessarily|no longer|never)\b|视情况|可能|通常|除外|除非|仅|只有|并非|不一定|节假日|[?？]/i.test(text)) return null;
  // Accept direct assertions, not a keyword substring inside a negated claim,
  // a question, a condition, or an unrelated booking instruction.
  const clauses = text.split(/[\n.;。；]+/).map((part) => part.trim())
    .filter((part) => /\breservations?\b|\bbookings?\b|\b(?:book|reserve)\b|预约|预订/i.test(part))
    .filter((part) => !/^(?:reservations?|bookings?)(?:\s+(?:policy|requirements?))?[:：]?$|^预约(?:规则|要求)?[:：]?$/i.test(part))
    .filter((part) => !/^reservation policy\s+(?:valid|effective)\s+from\s+20\d{2}-\d{1,2}-\d{1,2}\s+(?:to|through|until)\s+20\d{2}-\d{1,2}-\d{1,2}$/i.test(part))
    .map((part) => part.replace(/^(?:reservation (?:policy|requirements?)|预约规则|预约要求)\s*[:：]\s*/i, ""));
  if (!clauses.length) return null;
  const rules = clauses.map((part) => {
    if (/^(?:reservations?|bookings?)\s+(?:are|is)\s+not\s+required$|^no\s+(?:reservations?|bookings?)\s+(?:(?:is|are)\s+)?(?:required|needed)$|^(?:无需|不需要|不必)(?:提前)?(?:预约|预订)$/i.test(part)) return "not_required" as const;
    if (/^(?:reservations?|bookings?)\s+(?:are|is)\s+required(?:\s+in advance)?$|^(?:you\s+)?must\s+(?:book|reserve)(?:\s+in advance)?$|^(?:需要|必须|须)(?:提前)?(?:预约|预订)$|^(?:预约|预订)(?:是)?必须$/i.test(part)) return "required" as const;
    return null;
  });
  return rules.every((rule) => rule === rules[0]) ? rules[0] : null;
}

export type ExtractedEvidence = {
  matched: boolean; value: string; quote: string;
  hours?: { start: number; end: number };
  price?: { cents: number; unit: "per_person" | "per_ticket" | "one_time" | null };
};

// A small grammar may verify a simple timetable, but must not silently ignore
// extra access rules. Inspect the whole page, including separate paragraphs and
// times without an "opening hours" label. Uninterpreted conditions are retained
// for the user and prevent an automatic verified result.
export function openingHoursConditions(text: string): string[] {
  const weekday = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
  const dayRule = `(?:daily|every day|每日|每天|${weekday}\\s*(?:to|through|[-–—])\\s*${weekday}|(?:周|星期)[一二三四五六日天]\\s*(?:至|到|[-–—])\\s*(?:周|星期)?[一二三四五六日天])`;
  const time = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
  const simpleTimetable = new RegExp(`^(?:open(?:ing)? hours|opening times|开放时间|营业时间)\\s*[:：]?\\s*(?:from\\s+)?${dayRule}\\s*[,：:]?\\s*${time}\\s*(?:to|[-–—]|至)\\s*${time}$`, "i");
  const conditionLanguage = /\b(?:closed|closures?|closing|not open|only|except|unless|restrictions?|exceptions?|suspended|unavailable|prohibited|forbidden|must|shall|cannot|can't|not allowed|last entry|last admission)\b|\b(?:entry|admission|entrance|access|visits?|visitors?)\b[^\n]{0,100}\b(?:end|ends|stop|stops|cease|until|before|after|limit|limited|leave|vacate|permit|permitted)\b|闭馆|闭园|休馆|休园|休息日|停业|不开放|暂停|停止|截止|限时|限流|例外|除外|仅限|谢绝|禁止|不得|须|必须|清场|离馆|离园/i;
  const timeLanguage = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\d{1,2}\s*[点时]/i;
  const expanded = text.replace(/[（(]([^()（）]*)[）)]/g, "\n$1\n");
  return [...new Set(expanded.split(/[\n.;。；，]+/).map((clause) => clause.trim())
    .filter((clause) => clause && !simpleTimetable.test(clause) &&
      (conditionLanguage.test(clause) || timeLanguage.test(clause))))];
}

export function extractEvidence(
  field: EvidenceField,
  text: string,
): ExtractedEvidence {
  const patterns: Record<EvidenceField, RegExp> = {
    opening_hours: /open(?:ing)? hours|opening times|not open|last entry|last admission|no entry|开放时间|营业时间|closed|闭馆|不开放|停止入馆|停止入场/i,
    reservation: /reservation|booking|reserve|预约|预订/i,
    price: /free admission|admission fee|ticket price|price|门票|票价|免费/i,
    location: /\baddress\b|\blocation\b|地址|位置/i,
  };
  const lines = text.split(/\n+/).filter((line) => patterns[field].test(line));
  // Put restrictions before the ordinary timetable so a bounded quote cannot
  // hide a limiting paragraph behind introductory or repeated opening text.
  const relevant = [...new Set([
    ...(field === "opening_hours" ? openingHoursConditions(text) : []), ...lines,
  ])].join("\n");
  const quote = relevant.trim().slice(0, 600);
  const missing = { matched: false, value: "", quote };
  if (!relevant || relevant.length > 600 || /\b(?:may|might|subject to|seasonal|depending)\b|暂定|以现场为准|视情况/i.test(relevant)) return missing;
  if (field === "opening_hours") {
    const ranges = [...relevant.matchAll(/(?<!\d)((?:[01]?\d|2[0-3]):[0-5]\d)\s*(?:—|–|-|to|至)\s*((?:[01]?\d|2[0-3]):[0-5]\d)(?!\d)/gi)];
    const unique = [...new Map(ranges.map((match) => [`${match[1]}-${match[2]}`, match])).values()];
    if (unique.length !== 1) return missing;
    const [match] = unique;
    const minutes = (value: string) => { const [h, m] = value.split(":").map(Number); return h * 60 + m; };
    return { matched: true, value: match[0], quote, hours: { start: minutes(match[1]), end: minutes(match[2]) } };
  }
  if (field === "reservation") {
    const requirement = reservationRequirement(relevant);
    return requirement ? { matched: true, value: requirement, quote } : missing;
  }
  if (field === "price") {
    if (/\b(?:children|students|groups?|discount|not|except|only|deposit|refund|up to)\b|\b(?:from|starting)\s*(?:[¥￥]|CNY|RMB|\d)|儿童|学生|团体|优惠|起价|不免费|非免费|押金|退款|起|仅/i.test(relevant)) return missing;
    const free = /\bfree admission\b|免费(?:入场|开放|参观)?/i.test(relevant);
    const amounts = [...relevant.matchAll(/(?:￥|¥|CNY|RMB)\s*(\d+(?:\.\d{1,2})?)(?![\d.])|(\d+(?:\.\d{1,2})?)\s*(?:元|CNY|RMB)/gi)]
      .map((match) => Math.round(Number(match[1] ?? match[2]) * 100));
    if (free) amounts.push(0);
    const distinct = [...new Set(amounts)];
    if (distinct.length !== 1) return missing;
    const unit = /per person|每人|\/人/i.test(relevant) ? "per_person" :
      /per ticket|每票|每张票/i.test(relevant) ? "per_ticket" : /\btotal\b|一次性|总价/i.test(relevant) ? "one_time" : null;
    return { matched: true, value: `${distinct[0] / 100} 元${unit === "per_person" ? "/人" : unit === "per_ticket" ? "/票" : unit === "one_time" ? "（一次性）" : "（口径未标注）"}`, quote, price: { cents: distinct[0], unit } };
  }
  const values = [...relevant.matchAll(/(?:\baddress\b|\blocation\b|地址|位置)[^\S\n]*[:：][^\S\n]*([^\n;；]+)/gi)]
    .map((match) => match[1].trim().replace(/[。.]$/, ""))
    .filter((value) => value.length >= 3 && !/^(?:unknown|tbd|n\/?a|待定|暂无|未知|待确认)$/i.test(value));
  if (new Set(values).size !== 1) return missing;
  return { matched: true, value: values[0], quote };
}

export function sourceDateStatus(
  sourcePublishedAt: Date | null,
  eventDate: string,
) {
  if (!sourcePublishedAt) {
    return "undated";
  }
  const event = new Date(`${eventDate}T00:00:00`);
  const ageDays = (event.getTime() - sourcePublishedAt.getTime()) / 86_400_000;
  if (ageDays > 365) {
    return "outdated_for_trip";
  }
  if (sourcePublishedAt.getTime() > event.getTime()) {
    return "published_after_trip";
  }
  return "dated";
}

export function parseDuckDuckGoResults(html: string, limit = 5) {
  const results: { title: string; url: string }[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) && results.length < limit) {
    const attrs = match[1];
    if (!/class=["'][^"']*result__a/i.test(attrs)) {
      continue;
    }
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) {
      continue;
    }
    const rawHref = decodeHtmlEntities(hrefMatch[1]);
    let candidate: URL;
    try {
      candidate = new URL(
        rawHref.startsWith("//") ? `https:${rawHref}` : rawHref,
        "https://duckduckgo.com",
      );
    } catch {
      continue;
    }
    const target = candidate.searchParams.get("uddg");
    if (!target) {
      continue;
    }
    try {
      const url = new URL(target, "https://duckduckgo.com");
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        continue;
      }
      results.push({
        title: htmlToPlainText(match[2]).slice(0, 180),
        url: url.toString(),
      });
    } catch {
      continue;
    }
  }
  return results;
}
