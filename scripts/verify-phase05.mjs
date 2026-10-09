import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.PHASE05_BASE_URL ?? "http://127.0.0.1:3002";
const evidencePath = path.resolve(
  "docs",
  "阶段验收",
  "证据",
  "阶段-05-real-service.json",
);

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 500) };
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const createResult = await api("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    originalRequest:
      "阶段05验收：周末去长沙，两个人，预算 1500 元，喜欢自然风景和轻松节奏。",
  }),
});
assert(createResult.status === 201, "创建验收旅行失败。");
const tripId = createResult.payload.trip.id;

const extractResult = await api(`/api/trips/${tripId}/request/extract`, {
  method: "POST",
  body: JSON.stringify({ expectedRequestRevision: 1 }),
});
assert(
  extractResult.status === 200,
  `真实 AI 需求理解失败：HTTP ${extractResult.status} ${JSON.stringify(extractResult.payload)}`,
);
const extracted = extractResult.payload.request;
assert(extracted.requestRevision === 2, "AI 理解没有生成修订 2。");
assert(Boolean(extracted.extractedRequest?.destination), "AI 没有提取目的地。");
assert(
  extracted.extractedRequest?.budgetAmountCents === 150000,
  "AI 没有按人民币分保存预算。",
);
assert(
  extracted.extractedRequest?.budgetScope === "total",
  "预算口径没有按默认总预算显示。",
);
assert(
  Boolean(extracted.extractedRequest?.startDate) &&
    Boolean(extracted.extractedRequest?.endDate),
  "程序没有解析出具体日期。",
);

const confirmResult = await api(`/api/trips/${tripId}/request/confirm`, {
  method: "POST",
  body: JSON.stringify({ expectedRequestRevision: 2 }),
});
assert(confirmResult.status === 200, "确认当前修订失败。");

const staleConfirmResult = await api(`/api/trips/${tripId}/request/confirm`, {
  method: "POST",
  body: JSON.stringify({ expectedRequestRevision: 1 }),
});
assert(staleConfirmResult.status === 409, "旧修订确认没有被拒绝。");

const persistedResult = await api(`/api/trips/${tripId}/request`);
assert(persistedResult.status === 200, "读取持久化需求失败。");

const evidence = {
  executedAt: new Date().toISOString(),
  baseUrl,
  tripId,
  realService: true,
  checks: {
    createdTrip: createResult.status === 201,
    extractedRevision2: extracted.requestRevision === 2,
    destinationExtracted: Boolean(extracted.extractedRequest?.destination),
    budgetSavedAsCents:
      extracted.extractedRequest?.budgetAmountCents === 150000,
    budgetScopeVisible: extracted.extractedRequest?.budgetScope === "total",
    datesResolved:
      Boolean(extracted.extractedRequest?.startDate) &&
      Boolean(extracted.extractedRequest?.endDate),
    currentRevisionConfirmed:
      confirmResult.payload.request?.confirmedRevision === 2,
    staleRevisionRejected: staleConfirmResult.status === 409,
    persistedAfterRead: persistedResult.payload.request?.requestRevision === 2,
  },
  extractedRequest: extracted.extractedRequest,
  pendingQuestions: extracted.pendingQuestions,
  defaultAssumptions: extracted.defaultAssumptions,
  fieldSources: extracted.fieldSources,
  confirmedRevision: confirmResult.payload.request?.confirmedRevision,
  staleConfirmStatus: staleConfirmResult.status,
};

fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

if (Object.values(evidence.checks).some((value) => value !== true)) {
  throw new Error(`阶段05真实服务验收存在失败项，证据已写入 ${evidencePath}`);
}

console.log(`阶段05真实服务验收通过，证据：${evidencePath}`);
