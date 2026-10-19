import { afterEach, describe, expect, it, vi } from "vitest";
import { businessFetch } from "../lib/business-fetch";
import { PLANNING_COMPLETION_TIMEOUT_MS, PLANNING_REQUEST_TIMEOUT_MS } from "../lib/planning-timeouts";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("planning request budgets", () => {
  it.each(["request/extract", "plans/generate"])("keeps %s alive through both model attempts while respecting user cancellation", async (endpoint) => {
    vi.stubGlobal("document", { querySelector: () => ({ content: "test-generation" }) });
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();
    await businessFetch(`/api/trips/trip-1/${endpoint}`, { method: "POST", signal: controller.signal });
    expect(timeout).toHaveBeenCalledWith(PLANNING_REQUEST_TIMEOUT_MS);
    expect(PLANNING_REQUEST_TIMEOUT_MS).toBeGreaterThan(2 * PLANNING_COMPLETION_TIMEOUT_MS);
    const init = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(new Headers(init.headers).get("x-data-generation")).toBe("test-generation");
    expect(init.signal?.aborted).toBe(false);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it("preserves the ordinary request behavior", async () => {
    vi.stubGlobal("document", { querySelector: () => ({ content: "test-generation" }) });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    await businessFetch("/api/trips");
    expect(timeout).not.toHaveBeenCalled();
  });
});
