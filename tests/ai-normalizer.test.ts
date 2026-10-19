import { describe, expect, it } from "vitest";
import { normalizeMoneyCents, normalizeNodeType, normalizeTime, parseModelJson } from "../lib/ai-normalizer";
import { parseAIRequirementOutput } from "../lib/trip-request";

describe("universal model JSON normalization", () => {
  const payload = { events: [{ title: '九寨沟 {五花海} 步道，路牌写着“向右”', note: '路线: [A] -> [B]，引号 " 与反斜线 \\' }] };
  const json = JSON.stringify(payload);
  it.each([
    json,
    `\uFEFF  ${json}  `,
    `好的，以下是您的攻略。\n${json}\n祝旅行愉快！`,
    `<think>要先考虑 {"fake":true}，再检查 [地图]。</think>\n${json}`,
    `<analysis>隐藏草稿</analysis>\n\`\`\`json\n${json}\n\`\`\`\n已完成。`,
    `\`\`\`JSON\n${json}\n\`\`\``,
    JSON.stringify(json),
  ])("extracts complete content without modifying quoted text: %s", (raw) => {
    expect(parseModelJson(raw)).toEqual(payload);
  });

  it("accepts top-level arrays, comments and trailing commas", () => {
    expect(parseModelJson('以下是结果：```json\n[ { "url": "https://example.com/x//y", /* explanation */ "cost": 70, }, ]\n```谢谢'))
      .toEqual([{ url: "https://example.com/x//y", cost: 70 }]);
    expect(parseModelJson('{"note":"成都东站\n换乘巴士", /* explanation */}')).toEqual({ note: "成都东站\n换乘巴士" });
    expect(parseModelJson('您好，结果如下：\n{ /* bracket } ] { [ and quote " */ "events": [ { "title": "五花海", // comment } ] "\n "note": "保留 <think>路牌文字</think> 与 https://example.com/a//b", }, ], }\n祝您旅途愉快。'))
      .toEqual({ events: [{ title: "五花海", note: "保留 <think>路牌文字</think> 与 https://example.com/a//b" }] });
  });

  it("preserves reasoning-like tags inside valid JSON strings while removing actual reasoning blocks", () => {
    const data = { note: '<think>保留正文</think>，"字面引号"，<analysis>提示</analysis>' };
    expect(parseModelJson(JSON.stringify(data))).toEqual(data);
    expect(parseModelJson(`<think>推理中含 {"draft":true} 与引号"</think>\n${JSON.stringify(data)}`)).toEqual(data);
  });

  it("does not turn a truncated parent into a valid child or invent a successful answer", () => {
    expect(() => parseModelJson('{"events":[{"title":"已完成第一站"},')).toThrow("截断");
    expect(() => parseModelJson("服务余额不足，请充值后重试。")).toThrow("模型没有返回 JSON 对象");
  });

  it("selects the final complete result of the expected shape instead of introductory JSON examples", () => {
    const acceptsPlan = (value: unknown) => value !== null && typeof value === "object" && "events" in value;
    expect(parseModelJson(`示例：{"example":true}\n真正结果：${json}\n祝您玩得开心！`, acceptsPlan)).toEqual(payload);
    expect(parseModelJson(`示例：{"events":[]}\n真正结果：${json}`, acceptsPlan)).toEqual(payload);
    expect(parseModelJson(`示例：{"events":[]}\n真正结果：\`\`\`json\n${json}\n\`\`\``, acceptsPlan)).toEqual(payload);
    expect(parseModelJson(`示例：\`\`\`json\n{"events":[], /* example */}\n\`\`\`\n真正结果：${json}`, acceptsPlan)).toEqual(payload);
    expect(parseAIRequirementOutput('格式例子：{"success":true}\n实际需求：{"request":{"destination":"青岛"}}').request.destination).toBe("青岛");
    expect(() => parseModelJson('示例：{"events":[]}\n实际行程：{"events":[{"title":"九寨沟"},', acceptsPlan)).toThrow("截断");
    expect(() => parseModelJson('{"other":true}', acceptsPlan)).toThrow("所需字段");
  });

  it.each([
    [150000, "cents", 150000], [3000, "yuan", 300000], ["70元", "cents", 7000],
    ["¥ 1,250.50", "cents", 125050], ["￥８０．５", "cents", 8050], ["100分", "yuan", 100],
    [{ amount: 80, unit: "元" }, "cents", 8000], [{ value: "12.5", currency: "CNY" }, "cents", 1250],
    ["人均约70—90元", "cents", 8000], ["免费", "cents", 0], [null, "cents", null], ["待估算", "cents", null],
  ] as const)("converts explicit currency without scaling existing cents: %j", (value, unit, expected) => {
    expect(normalizeMoneyCents(value, unit)).toBe(expected);
  });

  it.each([["8:30", "08:30"], ["8：30", "08:30"], ["8点半", "08:30"], ["下午2时5分", "14:05"], ["2:30 pm", "14:30"], ["中午12点", "12:00"], ["23:59", "23:59"], ["24:30", null], ["8:90", null]])("standardizes %s", (raw, expected) => {
    expect(normalizeTime(raw)).toBe(expected);
  });

  it.each([["美食", "meal"], ["用餐", "meal"], ["早饭", "meal"], ["交通", "local_transport"], ["乘车", "local_transport"], ["高铁", "local_transport"], ["去程高铁", "departure_transport"], ["返程交通", "return_transport"], ["游览", "activity"], ["景区", "activity"], ["打卡", "activity"], ["酒店入住", "accommodation"], ["行前准备", "preparation"]])("maps %s into the internal category", (raw, expected) => {
    expect(normalizeNodeType(raw)).toBe(expected);
  });

  it("distinguishes returning to the hotel from paying for another overnight stay", () => {
    expect(normalizeNodeType("返回酒店休息 · 西湖东侧片区")).toBe("rest");
    expect(normalizeNodeType("回民宿休整")).toBe("rest");
    expect(normalizeNodeType("入住湖滨酒店并休息")).toBe("accommodation");
    expect(normalizeNodeType("accommodation")).toBe("accommodation");
  });

  it("fills optional requirements before schema validation and retains invalid-calendar checks", () => {
    const parsed = parseAIRequirementOutput('<think>先分析</think>```json\n{"request":{"destination":"九寨沟","startDate":"2026年11月1日","end_date":"2026/11/3","travelers":"两人","budgetAmountCents":"¥3000","budgetScope":"人均","pace":"轻松","interests":"摄影、藏餐","fieldSources":null},"openQuestions":null,"defaultAssumptions":null}\n```');
    expect(parsed.request).toMatchObject({ destination: "九寨沟", startDate: "2026-11-01", endDate: "2026-11-03", travelerCount: 2,
      budgetAmountCents: 300000, budgetScope: "per_person", pace: "relaxed", interests: ["摄影", "藏餐"], accommodation: null, constraints: [] });
    expect(parsed.request.fieldSources.destination).toBe("ai_extracted");
    expect(parsed.openQuestions).toEqual([]);
    expect(() => parseAIRequirementOutput('{"request":{"destination":"九寨沟","startDate":"2027/2/29"}}')).toThrow("日期不是有效的日历日期");
  });

  it("recognizes numeric yuan aliases and supplies missing question metadata", () => {
    const parsed = parseAIRequirementOutput(JSON.stringify({ city: "霞浦", budget: 1500, openQuestions: [{ field: "startDate", question: "哪天出发？" }] }));
    expect(parsed.request.budgetAmountCents).toBe(150000);
    expect(parsed.openQuestions).toMatchObject([{ id: "ai-question-1", field: "startDate", reason: "需要补充此项旅行偏好。" }]);
  });
});
