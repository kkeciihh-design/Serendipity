import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright";
import { launchExportBrowser } from "../lib/export-browser";

describe("export browser launch", () => {
  const browser = {} as Browser;
  const missing = new Error("browserType.launch: Executable doesn't exist at C:\\Users\\user\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1248\\chrome-headless-shell.exe");
  it("uses bundled Chromium normally with the existing sandbox and timeout", async () => {
    const launch = vi.fn().mockResolvedValue(browser);
    expect(await launchExportBrowser({ launch, platform: "win32" })).toBe(browser);
    expect(launch).toHaveBeenCalledExactlyOnceWith({ headless: true, timeout: 15_000, chromiumSandbox: true });
  });
  it("falls back to installed Edge only when the Windows bundled executable is absent", async () => {
    const launch = vi.fn().mockRejectedValueOnce(missing).mockResolvedValueOnce(browser);
    expect(await launchExportBrowser({ launch, platform: "win32" })).toBe(browser);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenLastCalledWith({ headless: true, timeout: 15_000, chromiumSandbox: true, channel: "msedge" });
  });
  it.each(["FONT_MISSING", "browserType.launch: Timeout 15000ms exceeded", "browserType.launch: Browser closed unexpectedly"])("does not conceal %s", async (message) => {
    const failure = new Error(message), launch = vi.fn().mockRejectedValue(failure);
    await expect(launchExportBrowser({ launch, platform: "win32" })).rejects.toBe(failure);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it("does not try a Windows channel on another platform or suppress an Edge launch failure", async () => {
    const launch = vi.fn().mockRejectedValue(missing);
    await expect(launchExportBrowser({ launch, platform: "linux" })).rejects.toBe(missing);
    expect(launch).toHaveBeenCalledTimes(1);
    const edgeFailure = new Error("Edge unavailable");
    launch.mockReset().mockRejectedValueOnce(missing).mockRejectedValueOnce(edgeFailure);
    await expect(launchExportBrowser({ launch, platform: "win32" })).rejects.toBe(edgeFailure);
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
