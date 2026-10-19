import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { test, expect } from "./fixtures";
import { controlledBasemap, expectCompanionBasemap } from "./basemap-helpers";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";

// Explicit opt-in replays a recorded live response through the real generation
// API. Routine E2E runs never read user credentials or call a paid model.
test.skip(!process.env.SERENDIPITY_LIVE_AI_RECORDING, "A recorded live model response was not supplied.");
test.use({ deviceScaleFactor: 2 });
process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data/e2e"));

test("recorded configured-model output preserves its detailed itinerary and map through generation and reload", async ({ page, request }) => {
  const directory = assertTestDataPath(path.resolve(process.env.SERENDIPITY_LIVE_AI_RECORDING!));
  const { snapshot } = JSON.parse(await fs.readFile(path.join(directory, "live-plan.json"), "utf8"));
  const summary = JSON.parse(await fs.readFile(path.join(directory, "live-result.json"), "utf8"));
  const raw = await fs.readFile(path.join(directory, `live-raw-${summary.attempt}.txt`), "utf8");
  const evidence = verificationEvidenceDirectory("universal-planning");
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const prompt: string = body.input;
    const content = prompt.includes("已确认需求快照：") ? raw : JSON.stringify({ request: snapshot, openQuestions: [], defaultAssumptions: [] });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: content }] }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Replay server failed");
  const settings = await import("../../lib/settings");
  try {
    const config = { provider: "openai-responses", baseUrl: `http://127.0.0.1:${address.port}/v1`, model: `${summary.model}-recorded`, apiKey: "isolated-recording-key" };
    await settings.saveAIConfiguration(config, settings.createTestToken(config));
    await page.setViewportSize({ width: 1600, height: 1100 });
    await controlledBasemap(page);
    await page.goto("/");
    await page.getByTestId("trip-request-input").fill("我和朋友从成都出发去九寨沟玩三天，两人预算6000元，请详细写交通换乘、景区入园和栈道游览路线、购票预约、特色美食和住宿片区。");
    await page.getByTestId("create-trip-submit").click();
    await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V1", { timeout: 30000 });
    const timeline = page.getByRole("list", { name: "当日行程时间轴" });
    const companion = page.getByRole("complementary", { name: "当日伴随看板" });
    await expect(timeline).toContainText("黄龙九寨站");
    await expect(timeline).toContainText("彭丰村");
    await expectCompanionBasemap(companion);
    await expect(companion.getByTestId("companion-budget-per-person")).toContainText("人均");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(evidence, "live-jiuzhaigou-day1-desktop@2x.png"), fullPage: true });
    await page.getByRole("button", { name: /^第 2 天｜/ }).click();
    await expect(timeline).toContainText("木栈道");
    await expect(timeline).toContainText("预约");
    await expect(timeline).toContainText("五花海");
    await expectCompanionBasemap(companion);
    await expect(companion.getByLabel("当日动线站点")).toContainText("①");
    await page.screenshot({ path: path.join(evidence, "live-jiuzhaigou-day2-desktop@2x.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectCompanionBasemap(companion);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidence, "live-jiuzhaigou-day2-mobile@2x.png"), fullPage: true });
    const tripId = new URL(page.url()).pathname.split("/").at(-1)!;
    const result = await request.get(`/api/trips/${tripId}/plans`);
    expect(result.ok()).toBe(true);
    await fs.writeFile(path.join(evidence, "live-saved-plan.json"), JSON.stringify(await result.json(), null, 2));
    await page.reload();
    await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V1");
    await expect(timeline).toContainText("黄龙九寨站");
    await expectCompanionBasemap(companion);
  } finally {
    await settings.closeSettingsStore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
