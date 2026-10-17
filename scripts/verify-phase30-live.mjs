import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { URL } from "node:url";
import { chromium } from "@playwright/test";
import { assertTestDataPath } from "./test-data-safety.mjs";

const root = assertTestDataPath(path.resolve("test-data/phase30-live"));
const output = assertTestDataPath(path.resolve("test-data/verification-output/phase30"));
await fs.mkdir(output, { recursive: true });
const configFile = path.join(output, "launcher.json");
const stateFile = path.join(output, "journey.json");
const mode = process.argv[2];
const base = "http://127.0.0.1:3142";
const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const save = (name, data) => fs.writeFile(path.join(output, name), JSON.stringify(data, null, 2));
function fingerprint(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map((r) => JSON.stringify(r)).sort();
      return [name, { count: rows.length, hash: hash(JSON.stringify(rows)) }];
    }));
  } finally { db.close(); }
}
async function control(action) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/desktop-control.mjs", action, "--config", configFile], { windowsHide: true });
    let data = ""; child.stdout.on("data", (chunk) => { data += chunk; });
    child.once("error", reject); child.once("exit", () => { try { const result = JSON.parse(data); assert.equal(result.ok, true, result.error); resolve(result); } catch (e) { reject(e); } });
  });
}
if (mode === "protect-before" || mode === "protect-after") {
  const formal = path.join(process.env.LOCALAPPDATA, "Serendipity");
  const fingerprints = { formal: fingerprint(path.join(formal, "data/serendipity.db")), demo28: fingerprint(path.resolve("test-data/phase28-live/data/serendipity.db")), securityKeyHash: hash(await fs.readFile(path.join(formal, "security.key"))) };
  if (mode === "protect-after") assert.deepEqual(fingerprints, JSON.parse(await fs.readFile(path.join(output, "protect-before.json"))).fingerprints);
  await save(`${mode}.json`, { at: new Date().toISOString(), fingerprints });
  console.log(`PASS ${mode}: SQLite integrity and all tables unchanged`);
} else if (mode === "start") {
  await save("launcher.json", { version: 1, projectRoot: process.cwd(), dataDirectory: root, nodePath: process.execPath, buildDirectory: ".next-phase30-verified", preferredPort: 3142 });
  const result = await control("start"); assert.equal(result.url, base); console.log(`Ready ${result.url}`);
} else if (mode === "restart") {
  const before = fingerprint(path.join(root, "data/serendipity.db"));
  const old = await control("status"); await control("stop");
  await assert.rejects(fetch(`${base}/api/runtime`));
  const next = await control("start"); assert.notEqual(next.pid, old.pid);
  assert.deepEqual(fingerprint(path.join(root, "data/serendipity.db")), before);
  await save("restart.json", { at: new Date().toISOString(), oldPid: old.pid, newPid: next.pid, fingerprints: before, unchanged: true });
  console.log("PASS real stop/start: all tables including generation and exports preserved");
} else if (mode === "upgrade") {
  const before = fingerprint(path.join(root, "data/serendipity.db"));
  await control("stop");
  const config = JSON.parse(await fs.readFile(configFile, "utf8")); config.buildDirectory = ".next-phase30-verified";
  await fs.writeFile(configFile, JSON.stringify(config)); await control("start");
  assert.deepEqual(fingerprint(path.join(root, "data/serendipity.db")), before);
  console.log("PASS final build started with all tables unchanged");
} else {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(25_000);
  const runtime = await (await fetch(`${base}/api/runtime`)).json();
  assert.equal(path.resolve(runtime.dataDirectory), root, "Refuse to mutate an unexpected data directory");
  let journey = {}; try { journey = JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { /* New isolated journey. */ }
  const generation = (await (await fetch(`${base}/api/data-management/status`)).json()).dataGeneration;
  async function api(url, body, method = body ? "POST" : "GET") {
    const csrf = (await page.context().cookies()).find((c) => c.name === "serendipity_csrf")?.value;
    const r = await page.request.fetch(base + url, { method, headers: { Origin: base, "x-data-generation": generation, ...(csrf ? { "x-csrf-token": csrf } : {}) }, ...(body ? { data: body } : {}), timeout: 205_000 });
    const data = await r.json(); assert.ok(r.ok(), `${r.status()} ${url}: ${data.error ?? "request failed"}`); return data;
  }
  const checkpoint = async (step, details) => { journey[step] = { at: new Date().toISOString(), ...details }; await fs.writeFile(stateFile, JSON.stringify(journey, null, 2)); console.log(`PASS ${step}`); };
  const current = async () => (await api(`/api/trips/${journey.trip.id}/plans`)).plans.find((p) => p.isCurrent);
  try {
    if (mode === "configure") {
      await page.goto(`${base}/settings`);
      await page.getByLabel("个人密码", { exact: true }).fill(crypto.randomBytes(24).toString("base64url"));
      const password = await page.getByLabel("个人密码", { exact: true }).inputValue();
      await page.getByLabel("确认个人密码").fill(password);
      await page.getByRole("button", { name: "设置密码", exact: true }).click();
      await page.getByRole("heading", { name: "AI 基本连接" }).waitFor();
      const formal = path.join(process.env.LOCALAPPDATA, "Serendipity");
      const db = new DatabaseSync(path.join(formal, "data/serendipity.db"), { readOnly: true });
      let row; try { row = db.prepare("SELECT provider,baseUrl,model,apiKeyCiphertext FROM AppSettings WHERE id='singleton'").get(); } finally { db.close(); }
      const key = Buffer.from(crypto.hkdfSync("sha256", await fs.readFile(path.join(formal, "security.key")), Buffer.alloc(0), Buffer.from("serendipity/settings-encryption"), 32));
      const [iv, tag, encrypted] = row.apiKeyCiphertext.split(".").map((x) => Buffer.from(x, "base64url"));
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
      const secret = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      await page.getByLabel("上游格式").selectOption(row.provider); await page.getByLabel("Base URL", { exact: true }).fill(row.baseUrl); await page.getByLabel("模型", { exact: true }).fill(row.model);
      await page.locator("#ai-api-key").fill(secret.toString()); secret.fill(0); key.fill(0);
      const testResult = page.waitForResponse((r) => r.url().endsWith("/api/settings/test"));
      await page.getByRole("button", { name: "测试连接", exact: true }).click(); assert.equal((await (await testResult).json()).ok, true);
      const saved = page.waitForResponse((r) => r.url().endsWith("/api/settings") && r.request().method() === "POST");
      await page.getByRole("button", { name: "保存配置", exact: true }).click(); assert.equal((await saved).status(), 200);
      await checkpoint("settings", { provider: row.provider, model: row.model, firstPasswordAndConfigurationViaBrowser: true, credentialsRecorded: false });
    } else if (mode === "generate") {
      assert.ok(!journey.trip, "Resume existing journey instead of creating duplicates");
      const originalRequest = "深圳出发去长沙，2026年10月29日至30日，2天1夜，1个人，全程预算1500元，节奏舒缓，喜欢当地美食和城市散步。住五一广场附近，未预订。去程计划10月29日07:21深圳北出发10:35到长沙南；返程10月30日19:00长沙南出发22:00到深圳北。希望去湖南博物院、太平老街、橘子洲，开放与预约需确认。请安排完整出门到返家衔接，所有未购票信息标估算。这是匿名合成验收，不是真实订单。";
      const { trip } = await api("/api/trips", { originalRequest }); journey.trip = { id: trip.id, originalRequest }; await checkpoint("created", { url: `${base}/trips/${trip.id}` });
      const extracted = await api(`/api/trips/${trip.id}/request/extract`, { expectedRequestRevision: 1 });
      await save("extracted.json", extracted); await checkpoint("extraction", { revision: extracted.request.requestRevision });
    } else if (mode === "confirm-generate") {
      const { request } = await api(`/api/trips/${journey.trip.id}/request`);
      await api(`/api/trips/${journey.trip.id}/request/confirm`, { expectedRequestRevision: request.requestRevision });
      const started = performance.now();
      const result = await api(`/api/trips/${journey.trip.id}/plans/generate`, { expectedRequestRevision: request.requestRevision, expectedPlanVersion: null });
      await save("generated-plan.json", result); await checkpoint("generation", { version: result.plan.versionNumber, events: result.plan.events.length, milliseconds: Math.round(performance.now() - started) });
      await page.goto(`${base}/trips/${journey.trip.id}`); await page.getByRole("heading", { name: /^计划版本 1/ }).waitFor(); await page.reload(); await page.getByRole("heading", { name: /^计划版本 1/ }).waitFor();
      await checkpoint("reopen", { refreshed: true });
    } else if (mode === "place") {
      const p = await current(), eventId = process.argv[3], keywords = process.argv[4], city = process.argv[5] ?? "长沙";
      const response = await api(`/api/trips/${journey.trip.id}/plans/${p.versionNumber}/places`, { eventId, keywords, city });
      const candidates = response.candidates;
      await save(`places-${eventId}.json`, { at: new Date().toISOString(), city, keywords, candidates: candidates.map((c) => ({ ...c, selectionToken: undefined })) });
      assert.ok(candidates.length, "No real place result");
      const candidate = candidates.find((c) => c.name.includes(keywords));
      assert.ok(candidate, "No matching place name; do not apply an unrelated search result");
      const result = await api(`/api/trips/${journey.trip.id}/plans/${p.versionNumber}/places`, { eventId, selectionToken: candidate.selectionToken, precision: /boundary:|place:(city|town|village|suburb)/.test(candidate.category) ? "area_reference" : "poi" }, "PATCH");
      await checkpoint(`place-${eventId}`, { version: result.plan.versionNumber, name: candidate.name, provider: candidate.provider, source: candidate.sourceUrl });
    } else if (mode === "route") {
      const p = await current(); const result = await api(`/api/trips/${journey.trip.id}/plans/${p.versionNumber}/routes`, { fromEventId: process.argv[3], toEventId: process.argv[4], mode: "walking" });
      await save("real-route.json", result.plan.routeLegs); await checkpoint("route", { version: result.plan.versionNumber, routes: result.plan.routeLegs.length });
    } else if (mode === "evidence") {
      const p = await current(); const event = p.events.find((e) => e.type === "activity" && /湖南博物/.test(e.title)); assert.ok(event);
      const result = await api(`/api/trips/${journey.trip.id}/plans/${p.versionNumber}/evidence`, { eventId: event.id, field: "opening_hours", query: process.argv[3] ?? "湖南博物院 开放时间", officialHost: "hnmuseum.com" });
      await save("real-source.json", result); await checkpoint("source", { status: result.fact.status, readStatus: result.fact.readStatus, sourceUrl: result.fact.sourceUrl });
    } else if (mode === "ticket") {
      const ticketFile = path.join(output, "synthetic-ticket.png");
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.setContent('<html lang="zh-CN"><meta charset="utf-8"><style>body{background:white;color:#14283d;font-family:"Microsoft YaHei";padding:35px}h1{font-size:32px}p{font-size:30px;margin:30px 0}.route{font-size:44px;font-weight:bold}</style><h1>已购车票</h1><p class="route">深圳北　G6012　长沙南</p><p>出发：2026年10月29日 07:21</p><p>到达：2026年10月29日 10:35</p><p>05车08A 二等座</p><p>票价：243.00元</p><p>合成识别样本 · 非实际班次或购票凭证</p></html>');
      await page.screenshot({ path: ticketFile });
      const before = await current();
      await page.goto(`${base}/trips/${journey.trip.id}`); await page.getByRole("tab", { name: "门到门交通", exact: true }).click();
      const importer = page.getByRole("region", { name: "去程交通", exact: true }).getByRole("region", { name: "截图导入", exact: true });
      await importer.getByRole("button", { name: "导入高铁票截图", exact: true }).click(); await importer.locator('input[type="file"]').setInputFiles(ticketFile);
      const recognized = page.waitForResponse((r) => r.url().endsWith("/api/ticket-import"));
      await importer.getByRole("button", { name: "识别选中区域", exact: true }).click(); const recognition = await recognized; assert.equal(recognition.status(), 200); await save("real-ocr.json", await recognition.json());
      assert.equal((await current()).versionNumber, before.versionNumber);
      await importer.getByLabel("这张截图用于").selectOption("new");
      await importer.getByRole("button", { name: "修正并核对票面", exact: true }).click();
      const editor = page.getByRole("region", { name: "手工票面", exact: true });
      assert.equal(await editor.getByLabel("出发时刻", { exact: true }).inputValue(), "07:21");
      await editor.getByLabel("出发站点 / 机场", { exact: true }).fill("深圳北");
      await editor.getByLabel("到达站点 / 机场", { exact: true }).fill("长沙南");
      await editor.getByLabel("门到门起点", { exact: true }).fill("深圳北站公共广场（合成演练）");
      await editor.getByRole("combobox", { name: "前段接驳方式", exact: true }).selectOption("walking"); await editor.getByLabel("前段接驳总耗时（分钟）", { exact: true }).fill("20");
      await editor.getByLabel("后段接驳总耗时（分钟）", { exact: true }).fill("50");
      await editor.getByRole("checkbox", { name: "我已核对票面，确认这是已购有效票", exact: true }).check();
      const saved = page.waitForResponse((r) => r.url().endsWith("/tickets") && r.request().method() === "POST");
      await editor.getByRole("button", { name: "确认票面并保存", exact: true }).click(); const result = await saved; assert.equal(result.status(), 200, await result.text());
      const after = await current(); assert.equal(after.tickets[0].status, "active"); assert.equal(after.tickets[0].importSource.engine, "tesseract-local");
      const redlines = await api(`/api/trips/${journey.trip.id}/plans/${after.versionNumber}/redlines`); await save("real-redlines.json", redlines);
      await checkpoint("ticket", { version: after.versionNumber, engine: "tesseract-local", draftDidNotChangePlan: true, redlines: redlines.redlines.length });
    } else if (mode === "edit") {
      const p = await current(), eventId = process.argv[3], event = p.events.find((e) => e.id === eventId); assert.ok(event);
      const { plan } = await api(`/api/trips/${journey.trip.id}/plans/${p.versionNumber}`, { type: "event", eventId, timeEdit: "start_end", startTime: process.argv[4], endTime: process.argv[5], endDate: event.date, note: event.note, locked: event.locked, status: event.status, remove: false }, "PATCH");
      await checkpoint(`edit-${eventId}`, { version: plan.versionNumber, start: process.argv[4], end: process.argv[5] });
    } else if (mode === "replan") {
      const p = await current(), scenario = process.argv[3] ?? "rain";
      const reasons = { rain: "下雨了，请将第二天橘子洲的户外游览改为长沙简牍博物馆室内游览；保留其他已确认事项、有效车票与已完成步骤。", late: "第二天晚起一小时，把第二天早餐向后推迟一小时，必要时调整随后未确认活动，保留有效车票和已完成事项。", remove: "删除第二天的一个尚未确认的景点游览，其他已确定事项和有效票据不变。" };
      const preview = await api(`/api/trips/${journey.trip.id}/replan`, { action: "preview", reason: reasons[scenario], expectedPlanVersion: p.versionNumber, expectedRequestRevision: p.requestRevision });
      await save(`replan-${scenario}-preview.json`, preview); assert.ok(preview.candidate.changes.length);
      let result = await api(`/api/trips/${journey.trip.id}/replan`, { action: "apply", candidateId: preview.candidate.id, expectedCandidateRevision: preview.candidate.revision });
      if (result.outcome === "review_required") { await save(`replan-${scenario}-recheck.json`, result); result = await api(`/api/trips/${journey.trip.id}/replan`, { action: "apply", candidateId: result.candidate.id, expectedCandidateRevision: result.candidate.revision }); }
      assert.equal(result.outcome, "applied"); assert.deepEqual(result.plan.tickets, p.tickets); await save(`replan-${scenario}-applied.json`, result); await checkpoint(`replan-${scenario}`, { version: result.plan.versionNumber, changes: preview.candidate.changes.length, ticketsPreserved: true });
    } else if (mode === "execute") {
      await page.goto(`${base}/trips/${journey.trip.id}/execute`); await page.getByRole("button", { name: "开始旅行", exact: true }).click();
      await page.getByRole("button", { name: "我已到达", exact: true }).click(); await page.getByRole("button", { name: "完成这一步", exact: true }).click();
      await page.reload(); await page.getByText(/已完成 1 \//).waitFor(); await checkpoint("execution", { completed: 1, refreshed: true });
    } else if (mode === "preparation") {
      const p = await current(); let { checklist } = await api(`/api/trips/${journey.trip.id}/checklist?planVersion=${p.versionNumber}`);
      ({ checklist } = await api(`/api/trips/${journey.trip.id}/checklist`, { expectedPlanVersion: p.versionNumber, expectedRevision: checklist.revision, expectedBasis: checklist.basis, change: { action: "complete", id: "essential:phone", completed: true } }));
      let { advisories } = await api(`/api/trips/${journey.trip.id}/advisories?planVersion=${p.versionNumber}`);
      ({ advisories } = await api(`/api/trips/${journey.trip.id}/advisories`, { action: "refresh", expectedPlanVersion: p.versionNumber, expectedRevision: advisories.revision }));
      await save("preparation-and-weather.json", { checklist, advisories }); await checkpoint("preparation", { checklistRevision: checklist.revision, advisoryRevision: advisories.revision });
    } else if (mode === "browse") {
      const results = [], errors = []; page.on("pageerror", (error) => errors.push(error.message));
      const routes = [["home", "/"], ["trips", "/trips"], ["runtime", "/runtime"], ["plan", `/trips/${journey.trip.id}`], ["map", `/trips/${journey.trip.id}?view=map`], ["execute", `/trips/${journey.trip.id}/execute`], ["mobile", `/trips/${journey.trip.id}/mobile`], ["text", `/trips/${journey.trip.id}/text`], ["image", `/trips/${journey.trip.id}/image`], ["pdf", `/trips/${journey.trip.id}/pdf`]];
      for (const [name, route] of routes) for (const width of [390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 }); const started = performance.now(); const r = await page.goto(base + route); assert.ok(r.ok());
        await page.evaluate(() => document.fonts.ready); await page.locator("h1").first().waitFor();
        if (name === "plan") await page.getByRole("button", { name: "保存标题", exact: true }).waitFor();
        if (name === "trips") await page.getByRole("link", { name: /打开继续/ }).first().waitFor();
        if (name === "runtime") await page.getByText("应用运行正常", { exact: true }).waitFor();
        if (name === "home") await page.waitForFunction(() => [...document.images].filter((img) => img.getBoundingClientRect().top < globalThis.innerHeight).every((img) => img.complete && img.naturalWidth > 0));
        if (["mobile", "text", "image", "pdf"].includes(name)) await page.getByText(/^当前计划 V/).first().waitFor();
        if (name === "execute") await page.getByRole("region", { name: "当前步骤", exact: true }).waitFor();
        if (name === "map") {
          await page.getByRole("tabpanel", { name: "地图", exact: true }).waitFor();
          const mapFrame = page.frameLocator('iframe[title="行程地点地图"]');
          await mapFrame.locator(".leaflet-container").waitFor();
          await mapFrame.locator("img.leaflet-tile-loaded").first().waitFor();
          await mapFrame.locator(".map-frame-message").waitFor({ state: "hidden" });
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth), `Overflow ${name} ${width}`);
        await page.screenshot({ path: path.join(output, `ui-${name}-${width}.png`) });
        results.push({ page: name, width, milliseconds: Math.round(performance.now() - started), navigation: await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd), responseMs: Math.round(n.responseEnd) }; }) });
      }
      assert.deepEqual(errors, []); await save("browser-visual-performance.json", { at: new Date().toISOString(), results, errors }); await checkpoint("browser", { pages: routes.length, widths: [390, 768, 1440], errors: 0 });
    } else if (mode === "offline") {
      const files = JSON.parse(await fs.readFile(path.join(output, "exports.json"), "utf8")), file = files.find((f) => f.format === "mobile-html");
      await page.context().setOffline(true); const requested = []; page.on("request", (r) => { if (/^https?:/.test(r.url())) requested.push(r.url()); });
      await page.setViewportSize({ width: 390, height: 844 }); await page.goto(new URL(`file:///${path.join(output, file.filename).replaceAll("\\", "/")}`).href);
      const body = await page.locator("body").innerText(); assert.match(body, /2026-10-29/); assert.match(body, /2026-10-30/); assert.match(body, /红线/); assert.equal(requested.length, 0);
      await page.screenshot({ path: path.join(output, "offline-first.png") }); await page.evaluate(() => globalThis.scrollTo(0, document.body.scrollHeight)); await page.screenshot({ path: path.join(output, "offline-last.png") });
      await checkpoint("offline", { browser: "Windows Edge with 390px viewport", actualPhone: false, networkRequests: requested.length, textLength: body.length });
    } else if (mode === "export") {
      const p = await current(); const files = [];
      for (const format of ["mobile-html", "plain-text", "markdown", "long-image", "pdf"]) {
        const start = performance.now(); const { file } = await api(`/api/trips/${journey.trip.id}/exports`, { expectedPlanVersion: p.versionNumber, format, options: { publicLandmark: "深圳北站公共广场" } });
        assert.equal(file.planVersion, p.versionNumber); assert.equal(file.requestRevision, p.requestRevision);
        for (let part = 1; part <= (file.parts?.length ?? 1); part++) {
          const r = await page.request.get(`${base}/api/trips/${journey.trip.id}/exports/${file.id}?download=1&part=${part}`); assert.ok(r.ok());
          const name = file.parts ? file.parts[part - 1].filename : file.filename;
          await fs.writeFile(path.join(output, name), await r.body());
        }
        files.push({ ...file, milliseconds: Math.round(performance.now() - start) }); await save("exports.json", files); console.log(`PASS export ${format}`);
      }
      assert.equal(new Set(files.map((f) => `${f.planVersion}/${f.requestRevision}/${f.checklistRevision}/${f.executionRevision}`)).size, 1);
      await checkpoint("exports", { count: files.length, version: p.versionNumber, coherentVersions: true });
    } else if (mode === "inspect") {
      const p = await current(); await save("current-plan.json", p); console.log(JSON.stringify({ version: p.versionNumber, request: p.requestSnapshot, events: p.events.map(({ id, dayNumber, title, locationName, startTime, endTime, type }) => ({ id, dayNumber, title, locationName, startTime, endTime, type })) }, null, 2));
    } else { throw new Error("Unknown mode"); }
  } catch (error) {
    if (mode !== "configure") {
      await page.screenshot({ path: path.join(output, `failure-${mode}.png`), fullPage: true }).catch(() => undefined);
      await fs.writeFile(path.join(output, `failure-${mode}.txt`), await page.locator("body").innerText()).catch(() => undefined);
    }
    throw error;
  } finally { await browser.close(); }
}
