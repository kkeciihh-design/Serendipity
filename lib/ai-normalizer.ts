/** Tolerant AI text parsing. Persisted data and user writes still use their strict schemas. */
export function stripModelReasoning(raw: string) {
  const text = raw.replace(/^\uFEFF/, "");
  let result = "";
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; result += char; continue; }
    if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index + 2);
      const stop = end < 0 ? text.length : end;
      result += text.slice(index, stop);
      index = stop - 1;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      const stop = end < 0 ? text.length : end + 2;
      result += text.slice(index, stop);
      index = stop - 1;
      continue;
    }
    if (char === "<") {
      const opening = text.slice(index).match(/^<(think|thinking|analysis|reasoning)\b[^>]*>/i);
      if (opening) {
        const remaining = text.slice(index + opening[0].length);
        const closing = new RegExp(`</${opening[1]}\\s*>`, "i").exec(remaining);
        // An unclosed reasoning block is not a completed model answer.
        if (!closing) break;
        index += opening[0].length + closing.index + closing[0].length - 1;
        continue;
      }
    }
    result += char;
  }
  return result.trim();
}

function repairJsonSyntax(raw: string) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (!escaped && (char === "\n" || char === "\r" || char === "\t")) {
        result += char === "\n" ? "\\n" : char === "\r" ? "\\r" : "\\t";
        continue;
      }
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; result += char; continue; }
    // Comments and trailing commas are harmless format differences. Never
    // rewrite characters inside strings (URLs, routes and notes included).
    if (char === "/" && raw[index + 1] === "/") {
      while (index < raw.length && raw[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (char === "/" && raw[index + 1] === "*") {
      const end = raw.indexOf("*/", index + 2);
      if (end < 0) return raw;
      index = end + 1;
      result += " ";
      continue;
    }
    if (char === "," && /^\s*[}\]]/.test(raw.slice(index + 1))) continue;
    result += char;
  }
  return result;
}

function balancedJsonCandidates(text: string) {
  const candidates: string[] = [];
  const stack: string[] = [];
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (start < 0) {
      if (char !== "{" && char !== "[") continue;
      start = index;
      stack.push(char);
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) break;
      index = end + 1;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.pop() !== expected) { stack.length = 0; start = -1; continue; }
      if (stack.length === 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return { candidates, incompleteTail: start >= 0 && /^[{[]\s*(?:["'{[]|-?\d|true\b|false\b|null\b|$)/.test(text.slice(start)) };
}

/** Extract a complete JSON object/array; never invent the tail of a truncated answer. */
export function parseModelJson(raw: string, acceptShape?: (value: unknown) => boolean): unknown {
  const cleaned = stripModelReasoning(raw);
  const scanned = balancedJsonCandidates(cleaned);
  if (scanned.incompleteTail) {
    throw new Error("模型输出末尾的 JSON 数据尚未完成，可能被输出长度限制截断。请重试或提高模型/网关的输出长度上限。");
  }
  // The balanced scanner ignores Markdown fences and keeps document order.
  // Prioritizing fences would incorrectly prefer an earlier fenced example.
  const candidates = [cleaned, ...scanned.candidates];
  const matches: unknown[] = [];
  let wrongShape = false;
  for (const candidate of [...new Set(candidates)]) {
    for (const variant of [candidate, repairJsonSyntax(repairJsonSyntax(candidate))]) {
      try {
        let parsed: unknown = JSON.parse(variant);
        // Some gateways serialize the model's JSON a second time.
        if (typeof parsed === "string") parsed = JSON.parse(repairJsonSyntax(parsed));
        if (parsed !== null && typeof parsed === "object") {
          if (!acceptShape) return parsed;
          if (acceptShape(parsed)) matches.push(parsed);
          else wrongShape = true;
          break;
        }
      } catch { /* Try the next complete candidate. */ }
    }
  }
  if (matches.length) return matches.at(-1);
  if (wrongShape) throw new Error("模型返回的数据缺少当前任务所需字段，请重新生成完整结果。");
  if (!/[{[]/.test(cleaned)) {
    throw new Error("模型没有返回 JSON 对象。请重试，或确认所选模型支持输出完整的行程数据。");
  }
  throw new Error("模型输出缺少完整的 JSON 数据，可能已被输出长度限制截断。请重试或提高模型/网关的输出长度上限。");
}

export function asModelRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function normalizeMoneyCents(value: unknown, defaultUnit: "cents" | "yuan" = "cents"): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    const object = asModelRecord(value);
    const unit = String(object.unit ?? object.currency ?? "").toLowerCase();
    return normalizeMoneyCents(object.amount ?? object.value ?? object.price,
      /分|cent/.test(unit) ? "cents" : /元|人民币|cny|rmb|yuan/.test(unit) ? "yuan" : defaultUnit);
  }
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * (defaultUnit === "yuan" ? 100 : 1)) : null;
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").replace(/[,，\s]/g, "");
  const unit = /分|cents?/i.test(text) ? "cents" : /元|[¥￥]|人民币|cny|rmb|yuan/i.test(text) ? "yuan" : defaultUnit;
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches?.length) return /^(免费|免票|free)$/i.test(text) ? 0 : null;
  // A range is an estimate, represented by its midpoint without claiming an exact quote.
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|—|–|~|～|至|到)\s*(\d+(?:\.\d+)?)/);
  const amount = range ? (Number(range[1]) + Number(range[2])) / 2 : Number(matches[0]);
  return Number.isFinite(amount) ? Math.round(amount * (unit === "yuan" ? 100 : 1)) : null;
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).normalize("NFKC").trim();
  const match = text.match(/^(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?(\d{1,2})(?:(?:[:：.时点h]\s*)(\d{1,2}|半)?(?:分)?)?(?:\s*(?:am|pm))?$/i);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = match[3] === "半" ? 30 : Number(match[3] ?? 0);
  if ((/下午|傍晚|晚上/.test(match[1] ?? "") || /pm$/i.test(text)) && hour < 12) hour += 12;
  if ((match[1] === "凌晨" || /am$/i.test(text)) && hour === 12) hour = 0;
  if (match[1] === "中午" && hour < 11) hour += 12;
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : null;
}

export function normalizeNodeType(value: unknown): "departure_transport" | "local_transport" | "return_transport" | "meal" | "activity" | "accommodation" | "rest" | "preparation" | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(departure_transport|local_transport|return_transport|meal|activity|accommodation|rest|preparation)$/.test(text)) {
    return text as Exclude<ReturnType<typeof normalizeNodeType>, null>;
  }
  if (/返程|回程|返家|return|inbound/.test(text)) return "return_transport";
  if (/去程|出发交通|departure|outbound/.test(text)) return "departure_transport";
  if (/美食|用餐|吃饭|早饭|午饭|晚饭|早餐|午餐|晚餐|餐饮|food|dining|breakfast|lunch|dinner|restaurant/.test(text)) return "meal";
  // Returning to a room already checked into is not another paid hotel night.
  // Explicit internal types above remain authoritative, including accommodation.
  if (/(?:返回|回到|回)(?:酒店|民宿|住处|住宿).*(?:休息|休整|就寝|睡觉)/.test(text)) return "rest";
  if (/住宿|酒店|民宿|入住|睡觉|hotel|lodging|stay/.test(text)) return "accommodation";
  if (/交通|乘车|高铁|火车|公交|地铁|打车|动车|巴士|航班|transport|transit|transfer|train|taxi|flight|bus/.test(text)) return "local_transport";
  if (/游览|景区|打卡|景点|游玩|观光|attraction|sight|visit/.test(text)) return "activity";
  if (/休息|午休|休闲|自由活动|break|relax/.test(text)) return "rest";
  if (/准备|行前|收拾|行李|预约|检查|packing|prepare/.test(text)) return "preparation";
  return null;
}

/** Correct a known model transliteration only in generated prose, never IDs or user input. */
export function normalizeGeneratedChineseText(text: string) {
  return text.replace(/身\s*fen\s*证/gi, "身份证");
}
