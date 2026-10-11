import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

export type Address = { address: string; family: number };
export type LookupLike = (hostname: string) => Promise<Address[]>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export const lookupPublicHost: LookupLike = (hostname) => dns.lookup(hostname, { all: true });

function isPublicIPv4(address: string) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function isPublicAddress(address: string, family = net.isIP(address)) {
  if (family !== net.isIP(address)) return false;
  if (family === 4) return isPublicIPv4(address);
  if (family !== 6 || address.includes("%")) return false;
  // WHATWG canonicalization converts dotted IPv4 tails to hex as well.
  const value = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words = (halves.length === 1 ? left : [
    ...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right,
  ]).map((part) => Number.parseInt(part, 16));
  if (words.slice(0, 5).every((part) => part === 0) && words[5] === 0xffff) {
    return isPublicIPv4(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  // Only native global unicast. Refuse special/transition ranges (including
  // NAT64, Teredo and 6to4) instead of guessing their ultimate connection target.
  return (words[0] & 0xe000) === 0x2000 && words[0] !== 0x2002 &&
    !(words[0] === 0x2001 && (words[1] < 0x200 || words[1] === 0xdb8)) &&
    !(words[0] === 0x3fff && words[1] < 0x1000);
}

export function validateExternalUrl(rawUrl: string) {
  let url: URL;
  try {
    if (rawUrl !== rawUrl.trim() || Array.from(rawUrl).some(
      (character) => character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )) throw new Error();
    url = new URL(rawUrl);
  } catch {
    throw new Error("来源链接格式不正确。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("只支持 HTTPS 或 HTTP 来源。");
  if (url.username || url.password) throw new Error("来源链接不能包含登录信息。");
  // Each protocol uses its default port; mismatched HTTP:443 is not a loophole.
  if (url.port) throw new Error("来源链接使用不支持的端口。");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = net.isIP(hostname);
  if (family) {
    if (!isPublicAddress(hostname, family)) throw new Error("不能访问本机或内网地址。");
  } else if (
    hostname.length > 253 || !hostname.includes(".") ||
    hostname.split(".").some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
    /\.(?:localhost|local|internal|home|lan|onion)$/.test(hostname)
  ) {
    throw new Error("不能访问本机或内网地址，或主机名格式不正确。");
  }
  url.hash = "";
  return url;
}

export async function resolvePublicAddress(url: URL, lookup: LookupLike, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = net.isIP(hostname);
  const records = family ? [{ address: hostname, family }] : await new Promise<Address[]>((resolve, reject) => {
    const aborted = () => reject(new Error("来源域名解析超时，已停止读取。"));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    lookup(hostname).then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
  signal.throwIfAborted();
  if (!records.length || records.some((record) => !isPublicAddress(record.address, record.family))) {
    throw new Error("来源域名解析到本机或内网地址，已停止读取。");
  }
  return records[0];
}

export function pinnedRequestOptions(url: URL, address: Address, signal: AbortSignal): https.RequestOptions & { autoSelectFamily: false } {
  if (!isPublicAddress(address.address, address.family)) throw new Error("不能访问本机或内网地址。");
  return {
    protocol: url.protocol,
    hostname: url.hostname.replace(/^\[|\]$/g, ""),
    path: `${url.pathname}${url.search}`,
    port: url.protocol === "https:" ? 443 : 80,
    method: "GET",
    agent: false,
    family: address.family,
    autoSelectFamily: false,
    // Node's actual connector uses this lookup; it cannot resolve the name again.
    // Keep the original hostname for Host, SNI and TLS certificate validation.
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    signal,
    headers: {
      Host: url.host,
      "User-Agent": "Serendipity/0.1 evidence-reader",
      Accept: "text/html,text/plain;q=0.9",
      "Accept-Encoding": "identity",
    },
  };
}

export async function fetchPinned(url: URL, address: Address, signal: AbortSignal) {
  return new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(pinnedRequestOptions(url, address, signal), (incoming) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = incoming.statusCode ?? 502;
      if (status < 200 || status > 599) {
        incoming.destroy();
        reject(new Error("来源返回了不支持的 HTTP 状态。"));
        return;
      }
      const body = [204, 205, 304].includes(status) ? null :
        Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
      if (!body) incoming.destroy();
      resolve(new Response(body, { status, headers }));
    });
    request.on("error", () => reject(new Error("来源连接失败或超时，已停止读取。")));
    request.end();
  });
}
