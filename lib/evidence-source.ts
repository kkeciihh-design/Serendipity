import dns from "node:dns/promises";
import net from "node:net";
import {
  extractEvidence,
  extractPageTitle,
  extractSourcePublishedAt,
  htmlToPlainText,
  isOfficialUrl,
  parseDuckDuckGoResults,
  sourceDateStatus,
  type EvidenceField,
} from "./evidence";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;

export type SearchLanguage = "en" | "zh-CN";

export type EvidenceCandidate = {
  status: "verified" | "unverified" | "conflict";
  sourceTitle: string;
  sourceUrl: string;
  sourcePublisher: string;
  sourcePublishedAt: Date | null;
  sourceDateStatus: string;
  contentQuote: string;
  extractedValue: string;
  conflictReason: string | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type LookupLike = (
  hostname: string,
) => Promise<{ address: string; family: number }[]>;

function isPrivateIPv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateAddress(address: string, family: number) {
  if (family === 4) {
    return isPrivateIPv4(address);
  }
  const value = address.toLowerCase();
  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb") ||
    value.startsWith("::ffff:127.") ||
    value.startsWith("::ffff:10.") ||
    value.startsWith("::ffff:192.168.")
  );
}

export function validateExternalUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("来源链接格式不正确。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("只支持 HTTPS 或 HTTP 来源。");
  }
  if (url.username || url.password) {
    throw new Error("来源链接不能包含登录信息。");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("来源链接使用不支持的端口。");
  }
  if (
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal")
  ) {
    throw new Error("不能访问本机或内网地址。");
  }
  if (net.isIP(url.hostname) === 4 && isPrivateIPv4(url.hostname)) {
    throw new Error("不能访问本机或内网地址。");
  }
  return url;
}

async function assertPublicHost(url: URL, lookup: LookupLike) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && isPrivateIPv4(url.hostname)) {
    throw new Error("不能访问本机或内网地址。");
  }
  const records = await lookup(url.hostname);
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address, record.family))) {
    throw new Error("来源域名解析到本机或内网地址，已停止读取。");
  }
}

async function readBodyWithLimit(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new Error("来源页面过大，已停止读取。");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new Error("来源页面过大，已停止读取。");
  }
  return buffer.toString("utf8");
}

export async function readSourcePage(
  rawUrl: string,
  options: {
    fetchImpl?: FetchLike;
    lookupImpl?: LookupLike;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const lookup = options.lookupImpl ??
    (async (hostname: string) => dns.lookup(hostname, { all: true }));
  let current = validateExternalUrl(rawUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertPublicHost(current, lookup);
    const response = await fetchImpl(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "User-Agent": "Serendipity/0.1 evidence-reader",
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("来源页面重定向地址缺失。");
      }
      if (redirectCount === MAX_REDIRECTS) {
        throw new Error("来源页面重定向次数过多。");
      }
      current = validateExternalUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      throw new Error(`来源页面读取失败（HTTP ${response.status}）。`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^text\/(?:html|plain)/i.test(contentType)) {
      throw new Error("来源不是可读取的网页正文。");
    }
    const html = await readBodyWithLimit(response);
    return {
      url: current.toString(),
      html,
      text: htmlToPlainText(html),
      title: extractPageTitle(html),
    };
  }

  throw new Error("来源页面无法读取。");
}

export async function searchDuckDuckGo(
  query: string,
  options: { fetchImpl?: FetchLike; language?: SearchLanguage } = {},
) {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${
    options.language === "zh-CN" ? "cn-zh" : "us-en"
  }`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": "Serendipity/0.1 evidence-reader",
      Accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`搜索服务不可用（HTTP ${response.status}）。`);
  }
  const html = await readBodyWithLimit(response);
  const results = parseDuckDuckGoResults(html);
  if (results.length === 0) {
    throw new Error("搜索没有返回可用结果。");
  }
  return results;
}

export async function collectEvidence(input: {
  field: EvidenceField;
  query: string;
  officialHost: string;
  eventDate: string;
  language?: SearchLanguage;
  fetchImpl?: FetchLike;
  lookupImpl?: LookupLike;
}) {
  const results = await searchDuckDuckGo(input.query, {
    fetchImpl: input.fetchImpl,
    language: input.language,
  });
  const officialResults = results.filter((result) => {
    try {
      return isOfficialUrl(new URL(result.url), input.officialHost);
    } catch {
      return false;
    }
  });
  if (officialResults.length === 0) {
    return {
      status: "unverified" as const,
      sourceTitle: results[0]?.title ?? "",
      sourceUrl: results[0]?.url ?? "",
      sourcePublisher: results[0] ? new URL(results[0].url).hostname : "",
      sourcePublishedAt: null,
      sourceDateStatus: "no_official_result",
      contentQuote: "",
      extractedValue: "",
      conflictReason: "搜索结果中没有匹配官方域名的页面；搜索摘要不能作为核验依据。",
    };
  }

  const errors: string[] = [];
  const verifiedCandidates: EvidenceCandidate[] = [];
  const dateInvalidCandidates: EvidenceCandidate[] = [];
  for (const result of officialResults) {
    try {
      const page = await readSourcePage(result.url, {
        fetchImpl: input.fetchImpl,
        lookupImpl: input.lookupImpl,
      });
      const publishedAt = extractSourcePublishedAt(page.html);
      const dateStatus = sourceDateStatus(publishedAt, input.eventDate);
      const evidence = extractEvidence(input.field, page.text);
      const candidate = {
          status: "unverified" as const,
          sourceTitle: page.title || result.title,
          sourceUrl: page.url,
          sourcePublisher: new URL(page.url).hostname,
          sourcePublishedAt: publishedAt,
          sourceDateStatus: dateStatus,
          contentQuote: evidence.quote,
          extractedValue: evidence.value,
          conflictReason:
            dateStatus === "outdated_for_trip"
              ? "来源发布日期早于行程日期超过一年，内容可能已过期。"
              : "来源发布日期晚于行程日期，内容不适用于本次出行。",
      };
      if (dateStatus === "outdated_for_trip" || dateStatus === "published_after_trip") {
        dateInvalidCandidates.push(candidate);
        continue;
      }
      if (!evidence.matched) {
        errors.push(`已读取 ${new URL(page.url).hostname}，但没有找到可核验的字段内容。`);
        continue;
      }
      verifiedCandidates.push({
        ...candidate,
        status: "verified" as const,
        contentQuote: evidence.quote,
        extractedValue: evidence.value,
        conflictReason: null,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "来源页面读取失败。");
    }
  }

  if (verifiedCandidates.length > 0) {
    const values = [
      ...new Set(
        verifiedCandidates
          .filter((candidate) => candidate.extractedValue)
          .map((candidate) => candidate.extractedValue),
      ),
    ];
    if (values.length > 1) {
      return {
        ...verifiedCandidates[0],
        status: "conflict" as const,
        conflictReason: `同一官方域名下多个页面内容不一致：${values.join("；")}。`,
      };
    }
    return verifiedCandidates[0];
  }
  if (dateInvalidCandidates.length > 0) {
    return dateInvalidCandidates[0];
  }

  return {
    status: "unverified" as const,
    sourceTitle: officialResults[0]?.title ?? "",
    sourceUrl: officialResults[0]?.url ?? "",
    sourcePublisher: officialResults[0]
      ? new URL(officialResults[0].url).hostname
      : "",
    sourcePublishedAt: null,
    sourceDateStatus: "unreadable",
    contentQuote: "",
    extractedValue: "",
    conflictReason:
      errors[0] ?? "没有实际读取到适用于本字段的官方页面正文。",
  };
}

export type CollectedEvidence = EvidenceCandidate;

export async function testSearchConnection(
  options: { fetchImpl?: FetchLike; language?: SearchLanguage } = {},
) {
  const results = await searchDuckDuckGo("Hunan Museum official website", {
    fetchImpl: options.fetchImpl,
    language: options.language,
  });
  return {
    resultCount: results.length,
    firstResult: results[0] ?? null,
  };
}
