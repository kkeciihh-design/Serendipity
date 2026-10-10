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

export type EvidenceFactClient = {
  id: string;
  planVersionId: string;
  targetType: "event";
  targetId: string;
  field: EvidenceField;
  status: EvidenceStoredStatus;
  effectiveStatus: EvidenceEffectiveStatus;
  sourceTitle: string;
  sourceUrl: string;
  sourcePublisher: string;
  sourcePublishedAt: string | null;
  sourceDateStatus: string | null;
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
  stale: "已过期",
};

export function effectiveEvidenceStatus(
  fact: Pick<
    EvidenceFactClient,
    "status" | "applicableUntil" | "lastRefreshStatus"
  >,
  now = new Date(),
): EvidenceEffectiveStatus {
  if (fact.status === "conflict") {
    return "conflict";
  }
  if (fact.lastRefreshStatus === "failed") {
    return "stale";
  }
  if (
    fact.status === "verified" &&
    fact.applicableUntil &&
    now.getTime() > new Date(fact.applicableUntil).getTime()
  ) {
    return "stale";
  }
  return fact.status === "verified" ? "verified" : "pending";
}

export function normalizeOfficialHost(input: string) {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) {
    throw new Error("官方域名格式不正确。");
  }
  return value;
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
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function extractPageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? htmlToPlainText(match[1]).slice(0, 180) : "";
}

export function extractSourcePublishedAt(html: string) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:updated_time)["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
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

export function extractEvidence(
  field: EvidenceField,
  text: string,
): { matched: boolean; value: string; quote: string } {
  const patterns: Record<EvidenceField, RegExp> = {
    opening_hours:
      /(?:open(?:ing)? hours|opening times|hours|开放时间|营业时间)([\s\S]{0,500})/i,
    reservation: /(?:reservation|booking|reserve|预约|预订)([\s\S]{0,500})/i,
    price: /(?:free admission|admission fee|ticket price|price|门票|票价|免费)([\s\S]{0,500})/i,
    location: /(?:address|location|地址|位置)([\s\S]{0,500})/i,
  };
  const match = text.match(patterns[field]);
  if (!match) {
    return { matched: false, value: "", quote: "" };
  }

  const quote = match[0].replace(/\s+/g, " ").trim().slice(0, 600);
  let value: string;
  if (field === "opening_hours") {
    const time = quote.match(
      /(?:[01]?\d|2[0-3]):[0-5]\d\s*(?:—|–|-|to|至)\s*(?:[01]?\d|2[0-3]):[0-5]\d/i,
    );
    value = time?.[0] ?? "";
  } else if (field === "price") {
    const price = quote.match(/(?:免费|free|￥\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|CNY|RMB))/i);
    value = price?.[0] ?? "";
  } else if (field === "reservation") {
    const requirement = quote.match(/(?:required|must|advance|需要|必须|提前)/i);
    value = requirement?.[0] ?? "";
  } else {
    const address = quote.match(/(?:No\.|Road|Street|路|街|号|区)/i);
    value = address?.[0] ?? "";
  }

  const matched =
    field === "opening_hours" ? Boolean(value) : field === "price" || field === "reservation" ? Boolean(value) : true;
  return { matched, value, quote };
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
