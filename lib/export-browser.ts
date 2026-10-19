import { chromium, type Browser, type LaunchOptions } from "playwright";

type Launch = (options: LaunchOptions) => Promise<Browser>;

/** Desktop package caches may be invisible to the ordinary Windows launcher. */
export async function launchExportBrowser(dependencies: { launch?: Launch; platform?: NodeJS.Platform } = {}): Promise<Browser> {
  const launch = dependencies.launch ?? ((options) => chromium.launch(options));
  const options: LaunchOptions = { headless: true, timeout: 15_000, chromiumSandbox: true };
  try {
    return await launch(options);
  } catch (error) {
    // Only a missing bundled executable warrants using installed Edge. Browser
    // crashes, sandbox, timeout, fonts and document errors retain their cause.
    if ((dependencies.platform ?? process.platform) !== "win32" || !(error instanceof Error) || !/Executable doesn't exist at/i.test(error.message)) throw error;
    return launch({ ...options, channel: "msedge" });
  }
}
