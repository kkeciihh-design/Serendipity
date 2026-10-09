import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.PHASE06_BASE_URL ?? "http://127.0.0.1:3002";
const evidenceDirectory = path.resolve("docs", "阶段验收", "证据");
const evidencePath = path.join(evidenceDirectory, "阶段-06-real-service.json");

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
    payload = text ? JSON.parse(text) : null;
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

function formatDate(date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function futureDates(days) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

function fieldSources() {
  return {
    destination: "user_confirmed",
    startDate: "program_derived",
    endDate: "program_derived",
    travelerCount: "user_confirmed",
    budgetAmountCents: "user_confirmed",
    budgetScope: "user_confirmed",
    pace: "user_confirmed",
    interests: "user_confirmed",
    accommodation: "unspecified",
    constraints: "unspecified",
  };
}

async function cleanupPhase06Trips() {
  const trips = await api("/api/trips");
  assert(trips.status === 200, "读取验收旅行列表失败。");
  for (const trip of trips.payload.trips ?? []) {
    if (
      trip.originalRequest.startsWith("阶段06验收：") ||
      trip.originalRequest.startsWith("阶段06四日验收：")
    ) {
      const deleted = await api(`/api/trips/${trip.id}`, {
        method: "DELETE",
      });
      assert(deleted.status === 200, `清理遗留验收旅行失败：${trip.id}`);
    }
  }
}

async function prepareConfirmedTrip(label, days, destination) {
  const dates = futureDates(days);
  const created = await api("/api/trips", {
    method: "POST",
    body: JSON.stringify({
      originalRequest: `${label}：${days}天${destination}基础行程，预算 1500 元。`,
    }),
  });
  assert(created.status === 201, "创建验收旅行失败。");
  const tripId = created.payload.trip.id;

  const draft = await api(`/api/trips/${tripId}/request`, {
    method: "PATCH",
    body: JSON.stringify({
      expectedRequestRevision: 1,
      request: {
        destination,
        startDate: dates.startDate,
        endDate: dates.endDate,
        travelerCount: 2,
        budgetAmountCents: 150000,
        budgetScope: "total",
        pace: "balanced",
        interests: ["城市漫步", "本地美食"],
        accommodation: null,
        constraints: [],
        fieldSources: fieldSources(),
      },
    }),
  });
  assert(draft.status === 200, `保存${days}天需求失败。`);

  const confirmed = await api(`/api/trips/${tripId}/request/confirm`, {
    method: "POST",
    body: JSON.stringify({ expectedRequestRevision: 2 }),
  });
  assert(confirmed.status === 200, `确认${days}天需求失败。`);
  return { tripId, dates };
}

function assertPlanStructure(plan, dates, expectedRevision, expectedVersion) {
  assert(plan.versionNumber === expectedVersion, "计划版本号不正确。");
  assert(plan.requestRevision === expectedRevision, "计划未绑定确认需求修订。");
  assert(
    plan.requestSnapshot.startDate === dates.startDate &&
      plan.requestSnapshot.endDate === dates.endDate,
    "计划没有保存需求确认快照。",
  );
  assert(plan.validationResults.errors.length === 0, "计划存在结构错误。");

  const dayCount = plan.events.reduce(
    (days, event) => new Set([...days, event.dayNumber]),
    new Set(),
  ).size;
  assert(dayCount === dates.days, "计划没有覆盖全部日期。");
  assert(
    plan.events.filter((event) => event.type === "departure_transport").length === 1,
    "计划缺少唯一去程交通。",
  );
  assert(
    plan.events.filter((event) => event.type === "return_transport").length === 1,
    "计划缺少唯一返程交通。",
  );
  for (let day = 1; day <= dates.days; day += 1) {
    const dayEvents = plan.events.filter((event) => event.dayNumber === day);
    assert(dayEvents.filter((event) => event.type === "meal").length >= 2, `第${day}天缺少用餐。`);
    assert(dayEvents.some((event) => event.type === "activity"), `第${day}天缺少活动。`);
    assert(dayEvents.some((event) => event.type === "rest"), `第${day}天缺少休息。`);
    assert(dayEvents.some((event) => event.type === "preparation"), `第${day}天缺少准备事项。`);
    if (day < dates.days) {
      assert(
        dayEvents.some((event) => event.type === "accommodation"),
        `第${day}天缺少住宿区域。`,
      );
    }
  }
  assert(plan.pendingItems.length > 0, "计划没有待确认事项。");
  assert(
    plan.events.every(
      (event) => event.costStatus === "estimated" || event.costStatus === "pending_confirmation",
    ),
    "计划费用被冒充为已确认事实。",
  );
}

const evidence = {
  executedAt: new Date().toISOString(),
  baseUrl,
  realService: true,
  checks: {},
  cases: [],
};

await cleanupPhase06Trips();

const twoDay = await prepareConfirmedTrip("阶段06验收", 2, "长沙");
const twoDayDates = { ...twoDay.dates, days: 2 };
const firstGeneration = await api(`/api/trips/${twoDay.tripId}/plans/generate`, {
  method: "POST",
  body: JSON.stringify({
    expectedRequestRevision: 2,
    expectedPlanVersion: null,
  }),
});
assert(
  firstGeneration.status === 200,
  `真实 AI 两日计划生成失败：HTTP ${firstGeneration.status} ${JSON.stringify(firstGeneration.payload)}`,
);
assertPlanStructure(firstGeneration.payload.plan, twoDayDates, 2, 1);
evidence.cases.push({
  case: "2-day-real-generation",
  tripId: twoDay.tripId,
  plan: firstGeneration.payload.plan,
});

const changedDestination = await api(`/api/trips/${twoDay.tripId}/request`, {
  method: "PATCH",
  body: JSON.stringify({
    expectedRequestRevision: 2,
    request: {
      ...firstGeneration.payload.plan.requestSnapshot,
      destination: "株洲",
      fieldSources: fieldSources(),
    },
  }),
});
assert(changedDestination.status === 200, "生成后修改需求失败。");
const reconfirmed = await api(`/api/trips/${twoDay.tripId}/request/confirm`, {
  method: "POST",
  body: JSON.stringify({ expectedRequestRevision: 3 }),
});
assert(reconfirmed.status === 200, "重新确认需求失败。");

const staleGeneration = await api(`/api/trips/${twoDay.tripId}/plans/generate`, {
  method: "POST",
  body: JSON.stringify({
    expectedRequestRevision: 2,
    expectedPlanVersion: 1,
  }),
});
assert(staleGeneration.status === 409, "旧需求生成结果没有被拒绝。");

const secondGeneration = await api(`/api/trips/${twoDay.tripId}/plans/generate`, {
  method: "POST",
  body: JSON.stringify({
    expectedRequestRevision: 3,
    expectedPlanVersion: 1,
  }),
});
assert(
  secondGeneration.status === 200,
  `真实 AI 新需求计划生成失败：HTTP ${secondGeneration.status} ${JSON.stringify(secondGeneration.payload)}`,
);
assertPlanStructure(secondGeneration.payload.plan, twoDayDates, 3, 2);
assert(
  secondGeneration.payload.plan.requestSnapshot.destination === "株洲",
  "新计划没有使用新确认需求快照。",
);

const stalePlanVersion = await api(`/api/trips/${twoDay.tripId}/plans/generate`, {
  method: "POST",
  body: JSON.stringify({
    expectedRequestRevision: 3,
    expectedPlanVersion: 1,
  }),
});
assert(stalePlanVersion.status === 409, "旧计划版本生成结果没有被拒绝。");

const plansAfterUpdate = await api(`/api/trips/${twoDay.tripId}/plans`);
assert(plansAfterUpdate.status === 200, "读取计划历史失败。");
const history = plansAfterUpdate.payload.plans;
assert(history.length === 2, "计划历史版本数量不正确。");
assert(history[0].versionNumber === 2, "当前计划版本不正确。");
assert(history[1].requestSnapshot.destination === "长沙", "旧计划快照被覆盖。");

const fourDay = await prepareConfirmedTrip("阶段06四日验收", 4, "成都");
const fourDayDates = { ...fourDay.dates, days: 4 };
const fourDayGeneration = await api(`/api/trips/${fourDay.tripId}/plans/generate`, {
  method: "POST",
  body: JSON.stringify({
    expectedRequestRevision: 2,
    expectedPlanVersion: null,
  }),
});
assert(
  fourDayGeneration.status === 200,
  `真实 AI 四日计划生成失败：HTTP ${fourDayGeneration.status} ${JSON.stringify(fourDayGeneration.payload)}`,
);
assertPlanStructure(fourDayGeneration.payload.plan, fourDayDates, 2, 1);
evidence.cases.push({
  case: "4-day-real-generation",
  tripId: fourDay.tripId,
  plan: fourDayGeneration.payload.plan,
});

evidence.checks = {
  twoDayGenerated: firstGeneration.status === 200,
  twoDayHasReturn: firstGeneration.payload.plan.events.some(
    (event) => event.type === "return_transport",
  ),
  oldRequestRejected: staleGeneration.status === 409,
  newRequestGenerated: secondGeneration.status === 200,
  oldPlanVersionRejected: stalePlanVersion.status === 409,
  oldSnapshotPreserved: history[1].requestSnapshot.destination === "长沙",
  fourDayGenerated: fourDayGeneration.status === 200,
  fourDaysCovered: new Set(
    fourDayGeneration.payload.plan.events.map((event) => event.dayNumber),
  ).size === 4,
  costsNotClaimedAsVerified: [
    ...firstGeneration.payload.plan.events,
    ...secondGeneration.payload.plan.events,
    ...fourDayGeneration.payload.plan.events,
  ].every(
    (event) =>
      event.costStatus === "estimated" || event.costStatus === "pending_confirmation",
  ),
};

fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(
  evidencePath,
  `${JSON.stringify(evidence, null, 2)}\n`,
  "utf8",
);

if (Object.values(evidence.checks).some((value) => value !== true)) {
  throw new Error(`阶段06真实服务验收存在失败项，证据已写入 ${evidencePath}`);
}

for (const tripId of [twoDay.tripId, fourDay.tripId]) {
  const deleted = await api(`/api/trips/${tripId}`, { method: "DELETE" });
  assert(deleted.status === 200, `清理验收旅行 ${tripId} 失败。`);
}

console.log(`阶段06真实服务验收通过，证据：${evidencePath}`);
