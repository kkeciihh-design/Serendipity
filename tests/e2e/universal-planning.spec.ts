import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { test, expect } from "./fixtures";
import { controlledBasemap, expectCompanionBasemap } from "./basemap-helpers";
import { requestFixture } from "../helpers/plan-fixtures";
import { verificationEvidenceDirectory } from "../helpers/evidence-directory";
import { assertTestDataPath } from "../../scripts/test-data-safety.mjs";
import { nextPlanDate, type PlanEvent } from "../../lib/plan";
import type { AIProvider } from "../../lib/ai-adapter";
import type { RequestSnapshot } from "../../lib/trip-request";

process.env.SERENDIPITY_DATA_DIR = assertTestDataPath(path.resolve("test-data/e2e"));
const evidence = verificationEvidenceDirectory("universal-planning");
let server: http.Server;
let settings: typeof import("../../lib/settings");
let baseUrl: string;
let destination = "九寨沟";
const capturedRequests: Record<string, unknown>[] = [];
test.use({ deviceScaleFactor: 2 });

function detailedPlan(snapshot: RequestSnapshot) {
  const scenic = snapshot.destination === "九寨沟";
  const coastal = snapshot.destination === "霞浦";
  const place = scenic ? "九寨沟沟口" : coastal ? "霞浦北岐村" : "青岛栈桥";
  const latitude = scenic ? 33.272 : coastal ? 26.883 : 36.061;
  const longitude = scenic ? 103.917 : coastal ? 120.042 : 120.316;
  const events: Record<string, unknown>[] = [];
  const add = (day: number, type: PlanEvent["type"], start: string, end: string, title: string, note: string, cost: number) => {
    const index = events.length;
    events.push({
      id: `day${day}-${index}`, dayNumber: String(day), date: day === 1 ? snapshot.startDate : nextPlanDate(snapshot.startDate!),
      startTime: start.replace(/^0/, "").replace(":", "："), endTime: end,
      type: type === "activity" ? "景区" : type === "meal" ? "用餐" : type,
      title, locationName: type === "accommodation" ? scenic ? "沟口彭丰村" : `${snapshot.destination}老城住宿片区` : place,
      note, costDraftCents: `${cost}元`, costStatus: null,
      // One missing coordinate exercises the destination fallback, too.
      ...(index % 3 ? { latitude: String(latitude + index * .001), longitude: String(longitude + index * .001) } : {}),
    });
  };
  add(1, "preparation", "06:00", "06:20", "出发前 · 检查身份证与预约凭证", "将实名预约二维码保存到手机，带上身份证、充电宝和轻便雨具。", 0);
  add(1, "meal", "06:20", "06:50", scenic ? "早餐 · 成都东站豆浆与包子" : "早餐 · 出发车站豆浆与包子", "在进站前吃热豆浆和包子，人均约20元，预留安检时间。", 40);
  add(1, "departure_transport", "07:00", "11:00", scenic ? "成都东站 → 黄龙九寨站 → 九寨沟沟口" : `出发地高铁站 → ${snapshot.destination}站 → ${place}`,
    scenic ? "成都东站乘动车至黄龙九寨站，约2小时；出站换乘景区直通巴士至九寨沟沟口，约2小时。先在铁路12306购买动车票，再按车站官方指引预约接驳巴士，预留30分钟换乘；两人动车和接驳合计参考约400元。" : `乘高铁抵达${snapshot.destination}站，出站后在出租车候车区打车至${place}，约40分钟；铁路12306购票，两人合计参考约400元。`, 400);
  add(1, "meal", "11:00", "12:00", scenic ? "午餐 · 沟口彭丰村牦牛肉面与青稞饼" : coastal ? "午餐 · 北岐村海鲜面与鱼丸汤" : "午餐 · 中山路鲅鱼水饺与辣炒蛤蜊", "在村口或老街沿线的明码标价小店用餐，点一份当地特色面食配热汤，人均参考约40元。", 80);
  add(1, "activity", "12:15", "16:00", scenic ? "九寨沟 · 五花海到珍珠滩瀑布木栈道" : coastal ? "北岐滩涂 · 村口观景台与海边步道" : "栈桥到八大关 · 沿海步道漫游",
    scenic ? "从九寨沟沟口游客中心检票入园 → 乘观光车至五花海站 → 沿环湖木栈道步行 → 珍珠滩 → 珍珠滩瀑布 → 在指定车站乘车返回沟口。提前通过九寨沟景区官方公众号进入实名预约渠道，门票与观光车套票人均参考280元，两人560元；季节票价、入园批次及开放栈道以官方发布为准。建议按此顺序安排约3至4小时，观景台停留时留出其他游客通道；不进入封闭路段，也不要为赶路跨越护栏。秋季早晚温差大，穿防滑徒步鞋，带抓绒、轻便雨衣、饮用水、防晒霜和便携路餐；高海拔步行放慢速度，感觉不适就缩短路线，在最近的观光车站返程。雨天木栈道湿滑，使用背包腾出双手，手机挂绳随身系好。" : `从${place}公共入口进入，按观景平台 → 海边步道 → 老街顺序步行，约3小时。出发前查看景区官方公众号预约公告及开放提示，人均门票参考50元。穿防滑鞋，携带防晒衣与水；沿海风大，注意潮汐并停留在开放步道内。`, scenic ? 560 : 100);
  add(1, "rest", "16:15", "16:45", "午后休整 · 游客中心补水", "在游客中心休息半小时，补充热水，检查返程乘车点。", 0);
  add(1, "meal", "17:00", "18:00", scenic ? "晚餐 · 彭丰村藏式牦牛肉汤锅与青稞饼" : coastal ? "晚餐 · 太康路海鲜排档的清蒸鱼和蛏子" : "晚餐 · 台东街区锅贴与海鲜家常菜", "选择明码标价、按重量确认价格的小店，特色菜搭配时蔬，两人合计约140元，人均70元。", 140);
  add(1, "accommodation", "18:30", "20:00", scenic ? "住宿 · 沟口彭丰村步行接驳片区" : `住宿 · ${snapshot.destination}老城交通便利片区`, scenic ? "推荐沟口彭丰村，距景区入口近，早晨步行或短程接驳方便；选有独立供暖、热水稳定的双床房，需要供氧服务时提前向酒店咨询。一间房每晚参考260至400元，本次按320元估算，预订前核对退改条款。" : "选择靠近公交站、餐饮集中的老城片区，优先双床房和可免费取消房型；避开酒吧临街房间，一间房每晚参考260至400元，按320元估算。", 320);
  add(2, "preparation", "07:00", "07:15", "返程前 · 整理行李并预约接驳", "核对当天车票时间，把行李寄存前台并约定取回时间。", 0);
  add(2, "meal", "07:30", "08:00", scenic ? "早餐 · 彭丰村青稞饼与酥油茶" : "早餐 · 老城海鲜粥与小笼包", "酒店周边早餐店用餐，人均约20元。", 40);
  add(2, "activity", "08:30", "12:00", scenic ? "漳扎镇 · 藏寨街巷与河谷慢行" : `${place} · 晨光步道与当地集市`, "从镇口公共步道进入，沿河谷步行至观景平台，再返回街巷集市；全程约3小时，公共步道免费，避免进入居民私人院落。", 0);
  add(2, "meal", "12:15", "13:00", scenic ? "午餐 · 漳扎镇牦牛肉炒饭" : "午餐 · 老城鱼丸汤与手工面", "在取行李前吃一份热食，人均约40元，餐后补足返程饮用水。", 80);
  add(2, "rest", "13:15", "13:30", "返程缓冲 · 前台取行李", "取回寄存行李，提前到达接驳巴士乘车点。", 0);
  add(2, "return_transport", "14:00", "18:00", scenic ? "九寨沟沟口 → 黄龙九寨站 → 成都东站" : `${place} → ${snapshot.destination}站 → 出发地`, "按预约地点乘接驳车至高铁站，预留至少45分钟安检候车时间，再乘动车返回；两人合计参考约400元。", 400);
  return { events, pendingItems: null };
}

test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
  settings = await import("../../lib/settings");
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    capturedRequests.push(body);
    const prompt: string = body.input ?? body.messages.at(-1).content;
    const line = prompt.split("\n").find((item) => item.startsWith("已确认需求快照："));
    const output = line ? detailedPlan(JSON.parse(line.slice("已确认需求快照：".length))) : {
      request: { ...requestFixture(2, { destination, travelerCount: 1 }), budgetAmountCents: "¥3000", fieldSources: null },
      openQuestions: null, defaultAssumptions: null,
    };
    const content = `已为您整理如下。\n<think>正在规划，临时草稿 {"debug":true}</think>\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\`\n祝旅途愉快。`;
    const payload = req.url?.endsWith("/responses")
      ? { output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "planning" }] }, { type: "message", content: [{ type: "output_text", text: content }] }] }
      : req.url?.endsWith("/messages")
        ? { content: [{ type: "thinking", thinking: "private analysis" }, { type: "text", text: content }], stop_reason: "end_turn" }
        : { choices: [{ message: { reasoning_content: "private analysis", content: [{ type: "text", text: content }] }, finish_reason: "stop" }] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Model fixture failed to start");
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

test.afterAll(async () => {
  await settings?.closeSettingsStore();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

for (const [provider, city] of [
  ["openai-chat-completions", "九寨沟"], ["openai-responses", "霞浦"], ["anthropic-messages", "青岛"],
] as const satisfies readonly (readonly [AIProvider, string])[]) {
  test(`${provider}: detailed unconfirmed itinerary, route and estimated budget survive the complete pipeline`, async ({ page, request }) => {
    destination = city;
    const config = { provider, baseUrl, model: "universal-format-fixture", apiKey: "isolated-test-key" };
    await settings.saveAIConfiguration(config, settings.createTestToken(config));
    const requestStart = capturedRequests.length;
    await page.setViewportSize({ width: 1600, height: 1100 });
    await controlledBasemap(page);
    await page.goto("/");
    await page.getByTestId("trip-request-input").fill(`我和朋友去${city}玩两天，从成都出发，我们预算3000元。请给出具体交通换乘、景区步道、预约渠道、特色美食和住宿片区。`);
    await page.getByTestId("create-trip-submit").click();
    await expect(page.getByTestId("plan-version-select")).toHaveText("版本 V1", { timeout: 30000 });
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const response = await request.get(`/api/trips/${id}/plans`);
    expect(response.ok()).toBe(true);
    const data = await response.json();
    await fs.writeFile(path.join(evidence, `${city}-saved-plan.json`), JSON.stringify(data, null, 2));
    const timeline = page.getByRole("list", { name: "当日行程时间轴" });
    await expect(timeline).toContainText("铁路12306");
    await expect(timeline).toContainText("官方公众号");
    await expect(timeline).toContainText("每晚参考260至400元");
    if (city === "九寨沟") {
      await expect(timeline).toContainText("沿环湖木栈道步行");
      await expect(timeline).toContainText("彭丰村藏式牦牛肉汤锅与青稞饼");
      await expect(timeline).toContainText("手机挂绳随身系好");
    }
    const companion = page.getByRole("complementary", { name: "当日伴随看板" });
    await expectCompanionBasemap(companion);
    await expect(companion.getByLabel("当日动线站点")).toContainText("①");
    await expect(companion).toContainText("人均");
    await expect(companion).toContainText("2 人");
    for (const category of ["交通", "门票", "餐饮", "住宿"]) await expect(companion).toContainText(category);
    await expect(companion).not.toContainText("待估算");
    await expect(companion).not.toContainText("确认地点后");
    const cards = timeline.locator('[data-timeline-level="experience"] > div > button').filter({ hasText: "铁路12306" });
    await expect(cards).toBeVisible();
    expect(await cards.evaluate((element) => {
      const instructions = [...element.querySelectorAll("span")].find((span) => span.className.includes("eventNote"));
      return Boolean(instructions && instructions.clientHeight >= instructions.scrollHeight);
    })).toBe(true);
    expect(capturedRequests.slice(requestStart)).toHaveLength(2);
    for (const body of capturedRequests.slice(requestStart)) {
      expect(body.response_format).toBeUndefined();
      expect(Number(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens)).toBeGreaterThanOrEqual(4096);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(evidence, `${city}-desktop@2x.png`), fullPage: true });
    if (city === "九寨沟") {
      await page.setViewportSize({ width: 390, height: 844 });
      await expectCompanionBasemap(companion);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: path.join(evidence, "九寨沟-mobile@2x.png"), fullPage: true });
    }
  });
}
