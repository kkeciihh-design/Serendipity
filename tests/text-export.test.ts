import { describe, expect, it } from "vitest";
import { renderTextExport } from "../lib/text-export";
import { renderMobileHtml } from "../lib/mobile-export";
import { mobileExportOptionsSchema, type TextExportFormat } from "../lib/export-snapshot";
import { calculateBudgetSummary, formatMoneyRange } from "../lib/budget";
import { checklistItemSchema } from "../lib/checklist";
import { nextPlanDate } from "../lib/plan";
import { exportFixture, PRIVATE_ADDRESS } from "./helpers/export-fixtures";
const options = mobileExportOptionsSchema.parse({});
const readable = (text: string) => text.replace(/\\([\\`*_{}[\]<>()#+.!|~&-])/g, "$1");
describe.each<TextExportFormat>(["plain-text", "markdown"])("%s snapshot export", (format) => {
  it.each([2, 4])("preserves %i days, sources, cross-day redlines, unknown prices and the webpage budget basis", async (days) => {
    const s = await exportFixture(days); s.requirementUpToDate = false; s.latestRequestRevision = 3;
    s.plan.costs[0].unitAmountCents = null;
    s.plan.costs[1].unitAmountCents = 12345; s.plan.costs[1].unitAmountMaxCents = 15678;
    s.plan.costs[1].paymentStatus = "refund_pending"; s.plan.costs[1].eventRemoved = true;
    s.evidence.push({ eventId: "d1-activity", field: "opening_hours", status: "stale", value: "周一闭馆 & 特展需预约", source: "合成场馆公告", retrievedAt: s.generatedAt, applicableFrom: s.generatedAt, applicableUntil: s.generatedAt });
    const before = JSON.stringify(s), raw = renderTextExport(s, options, format), text = readable(raw);
    const budget = calculateBudgetSummary(s.plan.costs, s.plan.requestSnapshot), money = formatMoneyRange(budget.totalMinCents, budget.totalMaxCents);
    expect(text).toContain(money); expect(renderMobileHtml(s, options)).toContain(money);
    expect(text).toContain("1 项金额待确认，未知不等于零"); expect(text).toContain("1 项退款待处理");
    for (const field of ["4 人", "1500 元", "计划待更新", "前一天", "22:55", "停止检票", "合成场馆公告", "周一闭馆", "获取", "适用", "车票待确认", "下一步", "清单修订 3", "执行修订 4"]) expect(text).toContain(field);
    expect(text).not.toContain("充裕");
    for (let d = 1; d <= days; d++) expect(text).toContain(`第 ${d} 天`);
    expect(JSON.stringify(s)).toBe(before); expect(renderTextExport(s, options, format)).toBe(raw);
    expect(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(raw, "utf8"))).toBe(raw);
  });
  it("filters dates while retaining pre-trip checklist, cross-midnight activity and full-trip amounts", async () => {
    const s = await exportFixture(4), first = s.plan.requestSnapshot.startDate!;
    const activity = s.plan.events.find((e) => e.id === "d1-activity")!; activity.startTime = "23:30"; activity.endTime = "00:30"; activity.endDate = nextPlanDate(first);
    s.checklist.items.push(checklistItemSchema.parse({ id: "packing", title: "证件 & 充电器 🧳", group: "essentials", note: "提醒", date: "2026-10-20", eventId: null, eventIds: [], ticketIds: [], source: "custom", sourceLabel: "用户自建", sourceKey: "packing", signature: "custom", officialUrl: null, custom: true, completed: true, completedAt: s.generatedAt, deleted: false, orphaned: false, changeNote: "请重新核对" }));
    const raw = renderTextExport(s, { ...options, dates: [first] }, format), text = readable(raw);
    expect(text).toContain("已确认 · 随身物品 · 证件 & 充电器 🧳"); expect(text).toContain("请重新核对");
    expect(text).toContain("不是所选日期小计"); expect(text).not.toContain("第 2 天");
    expect(text).toMatch(/23:30–\d{4}-\d{2}-\d{2} 00:30/);
    if (format === "markdown") expect(raw).toContain("- [x] 已确认");
    expect(() => renderTextExport(s, { ...options, dates: ["1999-01-01"] }, format)).toThrow("不属于");
  });
  it("privacy applies to every free-text section; opt-in never changes redline or exposes location payloads", async () => {
    const s = await exportFixture();
    const poison = `${PRIVATE_ADDRESS} 08车06A https://maps.test/?lat=22.543219 113.987654 12345678901234567X sk-abcdefghijklmnop`;
    s.plan.events[0].note = poison; s.plan.pendingItems[0].reason = poison; s.redlines[0].input.route.source = poison;
    s.evidence.push({ eventId: "d1-activity", field: "price", status: "pending", value: poison, source: poison, retrievedAt: s.generatedAt, applicableFrom: null, applicableUntil: null });
    s.execution.location = { source: "geolocation", latitude: 22.543219, longitude: 113.987654, accuracy: 3, recordedAt: s.generatedAt };
    const text = readable(renderTextExport(s, { ...options, publicLandmark: "市民中心南门" }, format));
    for (const token of [PRIVATE_ADDRESS, "08车06A", "maps.test", "22.543219", "113.987654", "12345678901234567X", "sk-abcdefghijklmnop", "currentEventId"]) expect(text).not.toContain(token);
    expect(text).toContain("市民中心南门"); expect(text).toContain("22:55");
    const opted = readable(renderTextExport(s, { ...options, includePrivateAddress: true, includeSeats: true }, format));
    expect(opted).toContain(PRIVATE_ADDRESS); expect(opted).toContain("08车06A"); expect(opted).not.toContain("113.987654"); expect(opted).toContain("22:55");
  });
});
it("Markdown escapes active markup and multiline source text without corrupting Chinese punctuation or emoji", async () => {
  const s = await exportFixture(); s.plan.events[0].note = '中文“旅行” 🧳 & <img src=x> ![图](file:test) **强调**\n# 伪造标题\u0000\u202e';
  const markdown = renderTextExport(s, options, "markdown"), plain = renderTextExport(s, options, "plain-text");
  expect(markdown).toContain('中文“旅行” 🧳 \\& \\<img src=x\\>'); expect(markdown).not.toContain("\n# 伪造标题");
  expect(markdown).not.toContain("![图](file:test)"); expect(plain).toContain('中文“旅行” 🧳 & <img src=x>');
  expect(markdown).not.toContain(String.fromCharCode(0)); expect(markdown).not.toContain("\u202e");
});
