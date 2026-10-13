import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertTestDataPath } from "../scripts/test-data-safety.mjs";

let fetchRouteJson: typeof import("../lib/route-service")["fetchRouteJson"];
const originalDataDirectory = process.env.SERENDIPITY_DATA_DIR;
beforeAll(async () => {
  process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data", "unused-route-http-store"));
  ({ fetchRouteJson } = await import("../lib/route-service"));
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  if (originalDataDirectory === undefined) delete process.env.SERENDIPITY_DATA_DIR;
  else process.env.SERENDIPITY_DATA_DIR = originalDataDirectory;
});
const endpoint = new URL("https://routing.openstreetmap.de/routed-foot/route/v1/foot/1,2;3,4");

describe("route response limits", () => {
  it("stops an oversized chunked body near the byte limit and cancels upstream", async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(256_000)); },
      cancel() { cancelled = true; },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    await expect(fetchRouteJson(endpoint)).rejects.toThrow("路线响应过大");
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(9);
  });

  it("cancels a declared oversized response before reading the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers: { "Content-Length": "2000001" } }));
    await expect(fetchRouteJson(endpoint)).rejects.toThrow("路线响应过大");
    expect(cancelled).toBe(true);
  });

  it("parses valid UTF-8 JSON split across chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ code: "Ok", label: "路线" }));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    await expect(fetchRouteJson(endpoint)).resolves.toEqual({ code: "Ok", label: "路线" });
  });
});
