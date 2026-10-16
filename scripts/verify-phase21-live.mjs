import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";
import { assertTestDataPath } from "./test-data-safety.mjs";
const mode = process.argv[2]; assert.ok(["prepare", "query", "before", "after", "browse", "settings"].includes(mode));
const base = "http://127.0.0.1:3131", root = assertTestDataPath(path.resolve("test-data/phase21-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase21-live")); await fs.mkdir(output, { recursive: true });
const dbPath = path.join(root, "data/serendipity.db"), seedFile = path.join(output, "seed.json");
async function api(url, body, method = body ? "POST" : "GET") {
  const response = await fetch(base + url, { method, headers: { Origin: base, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: globalThis.AbortSignal.timeout(55_000) });
  const data = await response.json(); assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`); return data;
}
if (mode === "prepare") {
  const source = new DatabaseSync(assertTestDataPath(path.resolve("test-data/phase20-live/data/serendipity.db")), { readOnly: true });
  let prior; try { prior = source.prepare('SELECT requestSnapshot FROM PlanVersion LIMIT 1').get(); } finally { source.close(); }
  assert.ok(prior); const snapshot = JSON.parse(prior.requestSnapshot);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = (offset) => new Date(Date.parse(today) + offset * 86_400_000).toISOString().slice(0, 10);
  snapshot.startDate = date(1); snapshot.endDate = date(2); snapshot.travelerCount = 2;
  const { trip } = await api("/api/trips", { originalRequest: "阶段21行程提醒演示：长沙两日合成旅行；时刻、酒店条件与预算供演练，天气由真实服务查询，没有实际购票、订房或预约。" });
  await api(`/api/trips/${trip.id}/request`, { expectedRequestRevision: 1, request: snapshot }, "PATCH");
  await api(`/api/trips/${trip.id}/request/confirm`, { expectedRequestRevision: 2 });
  const events = [];
  function add(day, id, type, startTime, endTime, title) { events.push({ id, type, dayNumber: day, date: date(day), startTime, endTime, title, locationName: title, costDraftCents: null, costStatus: "pending_confirmation", status: "suggested", locked: false, suggestedDurationSeconds: (Date.parse(`${date(day)}T${endTime}:00+08:00`) - Date.parse(`${date(day)}T${startTime}:00+08:00`)) / 1000, note: null }); }
  for (const day of [1, 2]) { add(day, `d${day}-prepare`, "preparation", "06:00", "06:15", "出行准备"); add(day, `d${day}-breakfast`, "meal", "08:00", "08:30", "早餐"); add(day, `d${day}-activity`, "activity", "10:30", "12:00", day === 1 ? "湖南博物院" : "橘子洲"); add(day, `d${day}-lunch`, "meal", "12:30", "13:30", day === 1 ? "火宫殿坡子街总店" : "午餐"); add(day, `d${day}-rest`, "rest", "14:30", "15:00", "休息"); }
  add(1, "departure", "departure_transport", "06:30", "07:30", "去程高铁（合成安排）"); add(2, "return", "return_transport", "17:00", "18:30", "返程高铁（合成安排）");
  add(1, "hotel", "accommodation", "13:45", "14:15", "五一广场周边酒店（合成条件）");
  events.at(-1).accommodationSelection = { stayId: "demo-stay", areaId: "demo-area", areaName: "五一广场周边", kind: "area", checkIn: date(1), checkOut: date(2), roomCount: 1, nightCount: 1, morningDepartureTime: "09:00", checkInFrom: "15:00", checkOutBy: "12:00", luggageStorage: "unknown", conditionNote: "合成演练条件，不代表任何酒店承诺。", selectedAt: new Date().toISOString() };
  const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath.replaceAll("\\", "/")}` } } });
  try {
    const p = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(snapshot), events: JSON.stringify(events), costs: "[]", pendingItems: "[]", validationResults: JSON.stringify({ status: "needs_review", errors: [], warnings: ["合成行程仅用于提醒演示，交通接驳、票据和具体酒店尚未确认。"] }) } });
    await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: p.id, status: "planned" } });
  } finally { await db.$disconnect(); }
  await fs.writeFile(seedFile, JSON.stringify({ tripId: trip.id, version: 1, url: `${base}/trips/${trip.id}?view=advisories` }, null, 2));
  console.log(`Prepared ${base}/trips/${trip.id}?view=advisories`);
} else if (mode === "settings") {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage(); await page.goto(`${base}/settings`);
    const password = "phase21-local-demo-only";
    if (await page.getByLabel("确认个人密码").count()) { await page.getByLabel("个人密码", { exact: true }).fill(password); await page.getByLabel("确认个人密码").fill(password); await page.getByRole("button", { name: "设置密码", exact: true }).click(); }
    else { await page.getByLabel("个人密码", { exact: true }).fill(password); await page.getByRole("button", { name: "进入设置", exact: true }).click(); }
    const section = page.getByRole("region", { name: "天气服务设置", exact: true }); await section.waitFor();
    await section.getByRole("button", { name: "测试并保存天气连接", exact: true }).click();
    await section.getByRole("status").filter({ hasText: "真实查询成功" }).waitFor({ timeout: 40_000 });
    await fs.writeFile(path.join(output, "weather-settings.json"), JSON.stringify({ checkedAt: new Date().toISOString(), message: await section.innerText(), settings: (await (await page.request.get(`${base}/api/settings/weather`)).json()) }, null, 2));
    await section.evaluate((e) => e.scrollIntoView({ block: "start" })); await page.screenshot({ path: path.join(output, "weather-settings.png") });
    console.log("Weather settings real query, signed save and browser flow passed.");
  } finally { await browser.close(); }
} else {
  const seed = JSON.parse(await fs.readFile(seedFile, "utf8"));
  if (mode === "query") {
    let { advisories } = await api(`/api/trips/${seed.tripId}/advisories?planVersion=1`);
    ({ advisories } = await api(`/api/trips/${seed.tripId}/advisories`, { action: "refresh", expectedPlanVersion: 1, expectedRevision: advisories.revision }));
    assert.ok(advisories.weather.some((w) => w.status === "fresh"));
    await fs.writeFile(path.join(output, "real-weather.json"), JSON.stringify({ checkedAt: new Date().toISOString(), ...advisories }, null, 2));
    const target = advisories.items.find((i) => i.category === "accommodation"); assert.ok(target);
    ({ advisories } = await api(`/api/trips/${seed.tripId}/advisories`, { action: "acknowledge", expectedPlanVersion: 1, expectedRevision: advisories.revision, advisoryId: target.id, signature: target.signature, acknowledged: true }));
    console.log(`Real weather: ${advisories.weather.filter((w) => w.status === "fresh").length} dated forecasts; acknowledged ${target.id}.`);
  } else if (mode === "before" || mode === "after") {
    const { advisories } = await api(`/api/trips/${seed.tripId}/advisories?planVersion=1`);
    const db = new DatabaseSync(dbPath, { readOnly: true }); let tables;
    try { assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok"); tables = ["Trip", "TripRequest", "PlanVersion", "EvidenceFact", "ChecklistState", "AdvisoryState", "AppSettings"].map((table) => { const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((r) => JSON.stringify(r)).sort(); return { table, count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") }; }); } finally { db.close(); }
    const result = { seed, advisories, tables };
    if (mode === "after") assert.deepEqual(result, JSON.parse(await fs.readFile(path.join(output, "before.json"), "utf8")));
    await fs.writeFile(path.join(output, `${mode}.json`), JSON.stringify(result, null, 2)); console.log(`${mode}: seven table fingerprints and reminder state ${mode === "after" ? "unchanged after restart" : "captured"}.`);
  } else {
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage(); await page.goto(seed.url); const panel = page.getByRole("tabpanel", { name: "行程提醒", exact: true });
      await panel.getByText("到店后的行李寄存待确认", { exact: true }).waitFor();
      for (const width of [390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); await panel.evaluate((e) => e.scrollIntoView({ block: "start" })); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth)); await page.screenshot({ path: path.join(output, `live-${width}.png`) }); }
      const rain = panel.locator('[data-advisory-id="rain:d2-activity"]');
      if (await rain.count()) { await page.setViewportSize({ width: 390, height: 1000 }); await rain.getByText("展开依据与来源").click(); await rain.evaluate((e) => e.scrollIntoView({ block: "start" })); await page.screenshot({ path: path.join(output, "live-rain-390.png") }); }
      await panel.getByLabel("显示已知事项（需处理的限制始终显示）").check(); assert.ok(await panel.getByRole("button", { name: "恢复提醒", exact: true }).count());
      await page.reload(); await panel.getByLabel("显示已知事项（需处理的限制始终显示）").check(); await panel.getByRole("button", { name: "恢复提醒", exact: true }).first().waitFor();
      await fs.writeFile(path.join(output, "browser.json"), JSON.stringify({ checkedAt: new Date().toISOString(), url: seed.url, widths: [390, 768, 1440], refreshedAndReopened: true }, null, 2)); console.log("New Edge session, refresh and three viewport checks passed.");
    } finally { await browser.close(); }
  }
}
