import { describe, expect, it } from "vitest";
import { renderMobileHtml } from "../lib/mobile-export";
import { mobileExportOptionsSchema } from "../lib/export-snapshot";
import { exportFixture, PRIVATE_ADDRESS } from "./helpers/export-fixtures";
import { checklistItemSchema } from "../lib/checklist";
const options = mobileExportOptionsSchema.parse({});
describe("mobile HTML snapshot projection", () => {
  it("keeps the previous-day 22:55 redline and its uncertainty without a live verdict", async () => {
    const snapshot = await exportFixture(), html = renderMobileHtml(snapshot, options);
    expect(html).toContain("前一天"); expect(html).toContain("22:55");
    expect(html).toContain("停止检票"); expect(html).toContain("估算"); expect(html).toContain("静态快照");
    expect(html).not.toMatch(/<script|<link|<img|充裕|距建议行动还有/);
    expect(html).toContain("下一步"); expect(html).toContain("北京时间");
  });
  it("T26 removes addresses, seats, coordinate URLs, raw payloads and active markup across fields", async () => {
    const s = await exportFixture();
    const poison = `${PRIVATE_ADDRESS} 08车06A https://maps.test/?lat=22.543219&lng=113.987654 <img src=x onerror=alert(1)> 12345678901234567X sk-abcdefghijklmnop`;
    s.plan.events[0].note = poison; s.plan.pendingItems[0].reason = poison;
    s.redlines[0].input.route.source = poison;
    s.execution.location = { source: "geolocation", latitude: 22.543219, longitude: 113.987654, accuracy: 3, recordedAt: s.generatedAt };
    const html = renderMobileHtml(s, options);
    for (const token of [PRIVATE_ADDRESS, "08车06A", "22.543219", "113.987654", "maps.test", "12345678901234567X", "sk-abcdefghijklmnop", "<img", "currentEventId", "imageFingerprint"]) expect(html).not.toContain(token);
    expect(html).toContain("&lt;img"); expect(html).toContain("私人地点已隐藏");
    const opted = renderMobileHtml(s, { ...options, includePrivateAddress: true, includeSeats: true });
    expect(opted).toContain(PRIVATE_ADDRESS); expect(opted).toContain("08车06A"); expect(opted).not.toContain("113.987654");
  });
  it.each([2, 4])("%i days retain separate anchored sections and the plan's own financial basis", async (days) => {
    const s = await exportFixture(days); s.requirementUpToDate = false; s.latestRequestRevision = 3;
    const html = renderMobileHtml(s, options);
    expect(html.match(/class="day"/g)).toHaveLength(days); expect(html).toContain("4 人"); expect(html).toContain("人均预算"); expect(html).toContain("1500 元"); expect(html).toContain("计划待更新");
    expect(html).toContain(s.plan.requestSnapshot.startDate!); expect(html).toContain(s.plan.requestSnapshot.endDate!);
    const single = renderMobileHtml(s, { ...options, dates: [s.plan.requestSnapshot.startDate!] });
    expect(single.match(/class="day"/g)).toHaveLength(1); expect(single).toContain("不是所选日期小计"); expect(single).toContain("该日未选入本文件");
    expect(() => renderMobileHtml(s, { ...options, dates: ["1999-01-01"] })).toThrow("不属于");
  });
  it("public landmark changes display only, never times or the underlying snapshot", async () => {
    const s = await exportFixture(), before = JSON.stringify(s);
    const html = renderMobileHtml(s, { ...options, publicLandmark: "市民中心南门" });
    expect(html).toContain("市民中心南门"); expect(html).toContain("22:55"); expect(html).toContain("未按它重新计算"); expect(JSON.stringify(s)).toBe(before);
  });
  it("pre-departure dated checklist items and saved confirmations remain in all-day and selected-day exports", async () => {
    const s = await exportFixture();
    s.checklist.items.push(checklistItemSchema.parse({ id: "packing", title: "提前准备证件", group: "essentials", note: "合成清单",
      date: "2026-10-20", eventId: null, eventIds: [], ticketIds: [], source: "custom", sourceLabel: "用户自建", sourceKey: "packing", signature: "custom", officialUrl: null,
      custom: true, completed: true, completedAt: s.generatedAt, deleted: false, orphaned: false, changeNote: null }));
    for (const dates of [null, [s.plan.requestSnapshot.startDate!]]) expect(renderMobileHtml(s, { ...options, dates })).toContain("☑ 已确认 · 随身物品 · 提前准备证件");
  });
});
