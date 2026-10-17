import {
  fetchPinned, lookupPublicHost, resolvePublicAddress, validateExternalUrl,
  type FetchLike, type LookupLike,
} from "./source-http";
export { validateExternalUrl } from "./source-http";
import {
  extractEvidence,
  extractPageTitle,
  extractSourcePublishedAt,
  htmlToPlainText,
  isOfficialUrl,
  normalizeOfficialHost,
  parseDuckDuckGoResults,
  type EvidenceField,
} from "./evidence";
import { evaluateEvidenceField, sourceApplicability, type EvidenceTarget } from "./evidence-evaluation";

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
  readStatus: "read" | "failed" | "not_read";
  applicableFrom: Date | null;
  applicableUntil: Date | null;
  contentQuote: string;
  extractedValue: string;
  conflictReason: string | null;
};

async function readBodyWithLimit(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error("来源页面过大，已停止读取。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("来源页面过大，已停止读取。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readSourcePage(
  rawUrl: string,
  options: {
    fetchImpl?: FetchLike;
    lookupImpl?: LookupLike;
    officialHost?: string;
  } = {},
) {
  const lookup = options.lookupImpl ?? lookupPublicHost;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let current = validateExternalUrl(rawUrl);
  const visited = new Set<string>();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (options.officialHost && !isOfficialUrl(current, options.officialHost)) {
      throw new Error("来源跳转到非官方域名，已停止读取。");
    }
    if (visited.has(current.href)) throw new Error("来源页面出现重定向循环。");
    visited.add(current.href);
    const address = await resolvePublicAddress(current, lookup, signal);
    // Injected fetch is only for controlled tests. Production always uses the
    // native connector pinned to the checked DNS address, never default fetch.
    const response = options.fetchImpl ? await options.fetchImpl(current.toString(), {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Serendipity/0.1 evidence-reader",
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.5",
      },
    }) : await fetchPinned(current, address, signal);
    if (response.redirected || (response.url && response.url !== current.href)) {
      await response.body?.cancel();
      throw new Error("来源连接未经允许改变了目标，已停止读取。");
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
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
      await response.body?.cancel();
      throw new Error(`来源页面读取失败（HTTP ${response.status}）。`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^text\/(?:html|plain)(?:\s*;|$)/i.test(contentType)) {
      await response.body?.cancel();
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
  options: { fetchImpl?: FetchLike; lookupImpl?: LookupLike; language?: SearchLanguage } = {},
) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${
    options.language === "zh-CN" ? "cn-zh" : "us-en"
  }`;
  const { html } = await readSourcePage(url, {
    ...options, officialHost: "duckduckgo.com",
  }).catch(() => { throw new Error("搜索服务不可用，请稍后重试。"); });
  if (/<form\b[^>]*\bid=["']challenge-form["']/i.test(html)) {
    throw new Error("搜索服务要求人机验证，暂时无法自动读取；请稍后重试。当前资料不会因此标为已核验。");
  }
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
  target?: EvidenceTarget;
  language?: SearchLanguage;
  fetchImpl?: FetchLike;
  lookupImpl?: LookupLike;
}): Promise<EvidenceCandidate> {
  const officialHost = normalizeOfficialHost(input.officialHost);
  const results = await searchDuckDuckGo(input.query, {
    fetchImpl: input.fetchImpl,
    lookupImpl: input.lookupImpl,
    language: input.language,
  });
  const officialResults = results.filter((result) => {
    try {
      return isOfficialUrl(new URL(result.url), officialHost);
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
      readStatus: "not_read",
      applicableFrom: null,
      applicableUntil: null,
      contentQuote: "",
      extractedValue: "",
      conflictReason: "搜索结果中没有匹配官方域名的页面；搜索摘要不能作为核验依据。",
    };
  }

  const errors: string[] = [];
  const candidates: EvidenceCandidate[] = [];
  for (const result of officialResults) {
    try {
      const page = await readSourcePage(result.url, {
        fetchImpl: input.fetchImpl,
        lookupImpl: input.lookupImpl,
        officialHost,
      });
      const publishedAt = extractSourcePublishedAt(page.html);
      const evidence = extractEvidence(input.field, page.text);
      const applicability = sourceApplicability(input.field, page.text, input.target);
      const heading = page.html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
      const evaluation = evaluateEvidenceField({ field: input.field, target: input.target,
        text: page.text, subject: page.title || (heading ? htmlToPlainText(heading) : ""), extracted: evidence });
      const publishedAfterTrip = publishedAt && publishedAt.getTime() > new Date(`${input.eventDate}T23:59:59+08:00`).getTime();
      candidates.push({
        status: publishedAfterTrip || applicability.status !== "applicable" ? "unverified" : evaluation.status,
        sourceTitle: page.title || result.title,
        sourceUrl: page.url,
        sourcePublisher: new URL(page.url).hostname,
        sourcePublishedAt: publishedAt,
        sourceDateStatus: publishedAfterTrip ? "published_after_trip" : applicability.status,
        readStatus: "read",
        applicableFrom: applicability.from,
        applicableUntil: applicability.until,
        contentQuote: evidence.quote || page.text.slice(0, 600),
        extractedValue: evidence.value,
        conflictReason: publishedAfterTrip ? "来源发布日期晚于出行日期，不能确认本次安排。" :
          applicability.reason ?? evaluation.reason,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "来源页面读取失败。");
    }
  }

  const conflictCandidate = candidates.find((candidate) => candidate.status === "conflict");
  if (conflictCandidate) return conflictCandidate;
  const verifiedCandidates = candidates.filter((candidate) => candidate.status === "verified");
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
  }
  // A successful field/page must not conceal another unresolved applicable
  // candidate. Keep the unresolved record and its trace for explicit review.
  const unresolved = candidates.find((candidate) => candidate.status === "unverified");
  if (unresolved) return unresolved;
  if (verifiedCandidates.length > 0) {
    return errors.length ? { ...verifiedCandidates[0], status: "unverified", conflictReason: `其他候选页面读取失败，仍需复核：${errors[0]}` } : verifiedCandidates[0];
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
    readStatus: "failed",
    applicableFrom: null,
    applicableUntil: null,
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
