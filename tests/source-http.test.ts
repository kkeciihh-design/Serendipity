import https from "node:https";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSourcePage, searchDuckDuckGo } from "../lib/evidence-source";
import { isPublicAddress, validateExternalUrl, type Address } from "../lib/source-http";
import { normalizeOfficialHost } from "../lib/evidence";

const publicAddress = { address: "93.184.216.34", family: 4 };
const publicLookup = async () => [publicAddress];
const page = () => new Response("<p>official content</p>", { headers: { "Content-Type": "text/html" } });
afterEach(() => vi.restoreAllMocks());

describe("source URL and connection boundary", () => {
  it("reports a search verification challenge separately from an empty result and does not follow it", async () => {
    const fetchImpl = vi.fn(async () => new Response('<form id="challenge-form" action="/anomaly.js">Verify</form>', {
      status: 202, headers: { "Content-Type": "text/html" },
    }));
    await expect(searchDuckDuckGo("museum", { fetchImpl, lookupImpl: publicLookup })).rejects.toThrow("人机验证");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(searchDuckDuckGo("museum", { fetchImpl: async () => page(), lookupImpl: publicLookup })).rejects.toThrow("没有返回可用结果");
  });
  it("rejects non-public IPv4, IPv6 and all private IPv4-mapped IPv6 forms", () => {
    const blocked = [
      "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "224.0.0.1", "198.18.0.1", "::", "::1", "fc00::1", "fd12::1", "fe80::1", "febf::1", "ff02::1",
      "::ffff:127.0.0.1", "::ffff:172.16.0.1", "::ffff:169.254.1.1", "::ffff:ac10:1", "::ffff:a9fe:101",
      "64:ff9b::a00:1", "2002:7f00:1::", "2001:db8::1", "::127.0.0.1", "fe80::1%eth0",
    ];
    for (const address of blocked) {
      expect(isPublicAddress(address), address).toBe(false);
      const host = address.includes(":") ? `[${address}]` : address;
      expect(() => validateExternalUrl(`http://${host}/`), address).toThrow();
    }
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicAddress("8.8.8.8", 6)).toBe(false);
  });

  it("normalizes URLs before checking and rejects protocols, ports and deceptive hostnames", () => {
    for (const url of [
      "http://2130706433", "http://0x7f000001", "http://127.1", "http://0177.0.0.1",
      "file:///secret", "ftp://example.com", "https://name:secret@example.com", "https://example.com:80",
      "http://example.com:443", "https://example.com:8443", "http://localhost.", "http://host.internal",
      "https://example.com./", "https://bad_host.example.com", "https://example.com\\@127.0.0.1",
      "https://exa\nmple.com", "http://machine", "https://-bad.example.com",
    ]) expect(() => validateExternalUrl(url), url).toThrow();
    expect(validateExternalUrl("https://EXAMPLE.COM:443/path#part").href).toBe("https://example.com/path");
    expect(normalizeOfficialHost("https://EXAMPLE.COM/")).toBe("example.com");
    for (const host of ["example.com@evil.com", "example.com:8080", "https://example.com/path", "example.com.", "evil..com"]) {
      expect(() => normalizeOfficialHost(host), host).toThrow();
    }
  });

  it("rejects a hostname if any DNS result is private, invalid or empty", async () => {
    const fetchImpl = vi.fn(async () => page());
    for (const records of [[], [publicAddress, { address: "::ffff:172.16.0.1", family: 6 }],
      [{ address: "garbage", family: 4 }], [{ address: "127.0.0.1", family: 4 }]]) {
      await expect(readSourcePage("https://example.com", { fetchImpl, lookupImpl: async () => records })).rejects.toThrow(/内网/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks every redirect against official hosts, IP rules and DNS", async () => {
    for (const location of ["https://evil.com/page", "https://example.com.evil.com", "http://127.0.0.1/"]) {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { Location: location } }));
      await expect(readSourcePage("https://example.com", { officialHost: "example.com", lookupImpl: publicLookup, fetchImpl })).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://www.example.com/page" } }));
    const lookup = vi.fn(async (host: string) => host === "example.com" ? [publicAddress] : [{ address: "10.0.0.1", family: 4 }]);
    await expect(readSourcePage("https://example.com", { officialHost: "example.com", lookupImpl: lookup, fetchImpl })).rejects.toThrow(/内网/);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("allows checked official redirects and rejects loops and excessive hops", async () => {
    const fetchImpl = vi.fn(async (url: string) => url.endsWith("/start")
      ? new Response(null, { status: 302, headers: { Location: "https://www.example.com/final" } }) : page());
    const result = await readSourcePage("https://example.com/start", { officialHost: "example.com", lookupImpl: publicLookup, fetchImpl });
    expect(result.url).toBe("https://www.example.com/final");
    const loop = async () => new Response(null, { status: 302, headers: { Location: "/start" } });
    await expect(readSourcePage("https://example.com/start", { lookupImpl: publicLookup, fetchImpl: loop })).rejects.toThrow(/循环/);
    let count = 0;
    const chain = async () => new Response(null, { status: 302, headers: { Location: `/hop-${++count}` } });
    await expect(readSourcePage("https://example.com/start", { lookupImpl: publicLookup, fetchImpl: chain })).rejects.toThrow(/次数过多/);
    expect(count).toBe(4);
  });

  it("binds the native HTTPS connector to the validated address without a second DNS resolution", async () => {
    const lookup = vi.fn(async (): Promise<Address[]> => lookup.mock.calls.length === 1
      ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }]);
    let connectorOptions: https.RequestOptions | undefined;
    vi.spyOn(https, "request").mockImplementation(((options: https.RequestOptions, callback: (res: unknown) => void) => {
      connectorOptions = options;
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const incoming = Object.assign(new PassThrough(), { statusCode: 200, headers: { "content-type": "text/html" } });
        callback(incoming);
        incoming.end("<p>checked connection</p>");
      };
      return request;
    }) as typeof https.request);
    const defaultFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("default fetch must not be used"));
    const result = await readSourcePage("https://example.com/page", { lookupImpl: lookup, officialHost: "example.com" });
    expect(result.text).toBe("checked connection");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(defaultFetch).not.toHaveBeenCalled();
    expect(connectorOptions).toMatchObject({ hostname: "example.com", agent: false, family: 4, autoSelectFamily: false });
    const connected = await new Promise((resolve, reject) => connectorOptions!.lookup!("example.com", {}, (error, address, family) => {
      if (error) reject(error); else resolve({ address, family });
    }));
    expect(connected).toEqual(publicAddress);
  });

  it("cancels oversized chunked bodies without buffering the entire response", async () => {
    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { chunks += 1; controller.enqueue(new Uint8Array(128 * 1024)); },
      cancel() { cancelled = true; },
    });
    await expect(readSourcePage("https://example.com", {
      lookupImpl: publicLookup,
      fetchImpl: async () => new Response(body, { headers: { "Content-Type": "text/html" } }),
    })).rejects.toThrow(/过大/);
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThanOrEqual(6);
  });
});
