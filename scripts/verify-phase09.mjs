import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.PHASE09_BASE_URL ?? "http://127.0.0.1:3003";
const evidenceDirectory = path.resolve("docs", "阶段验收", "证据");
const evidencePath = path.join(evidenceDirectory, "阶段-09-visual-check.json");
const dataDirectory = process.env.SERENDIPITY_DATA_DIR
  ? path.resolve(process.env.SERENDIPITY_DATA_DIR)
  : path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Serendipity");
const databaseUrl = `file:${path
  .join(dataDirectory, "data", "serendipity.db")
  .replaceAll("\\", "/")}`;

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Phase 09 verification failed: HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function apiStatus(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  await response.text();
  return response.status;
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

const dates = futureDates(2);
const fieldSources = {
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
const requestSnapshot = {
  destination: "长沙",
  startDate: dates.startDate,
  endDate: dates.endDate,
  travelerCount: 2,
  budgetAmountCents: 130000,
  budgetScope: "total",
  pace: "balanced",
  interests: ["城市漫步"],
  accommodation: null,
  constraints: [],
  fieldSources,
};

const event = (id, dayNumber, type, title, startTime, endTime) => {
  const date = dayNumber === 1 ? dates.startDate : dates.endDate;
  return {
    id,
    dayNumber,
    date,
    startTime,
    endTime,
    type,
    title,
    locationName: type === "preparation" ? null : "长沙区域",
    suggestedDurationSeconds: 3600,
    costDraftCents: null,
    costStatus: "pending_confirmation",
    note: null,
  };
};

const events = [
  event("d1-preparation", 1, "preparation", "当日准备", "07:30", "07:50"),
  event("d1-breakfast", 1, "meal", "早餐", "08:00", "08:45"),
  event("departure", 1, "departure_transport", "前往长沙", "09:00", "10:00"),
  event("d1-activity", 1, "activity", "城市公园散步", "11:00", "12:00"),
  event("d1-taxi", 1, "local_transport", "打车前往展览", "12:10", "12:30"),
  event("d1-lunch", 1, "meal", "午餐", "12:40", "13:30"),
  event("d1-optional", 1, "activity", "可选城市展览", "14:00", "15:00"),
  event("d1-rest", 1, "rest", "回酒店休息", "15:10", "15:40"),
  event("d1-hotel", 1, "accommodation", "住宿区域", "20:00", "22:00"),
  event("d2-preparation", 2, "preparation", "返程前准备", "07:30", "07:50"),
  event("d2-breakfast", 2, "meal", "早餐", "08:00", "08:45"),
  event("d2-activity", 2, "activity", "湘江边散步", "10:00", "12:00"),
  event("d2-lunch", 2, "meal", "午餐", "12:30", "13:30"),
  event("d2-rest", 2, "rest", "休息", "14:00", "14:30"),
  event("return", 2, "return_transport", "返程", "17:00", "19:00"),
];

const cost = (id, category, unitAmountCents) => ({
  id: `cost-${id}`,
  linkedEventId: id,
  category,
  currency: "CNY",
  unit: "one_time",
  unitAmountCents,
  unitAmountMaxCents: null,
  quantity: null,
  certainty: unitAmountCents === null ? "pending_confirmation" : "user_confirmed",
  paymentStatus: "not_paid",
  source: unitAmountCents === null ? "ai_draft" : "user_confirmed",
  eventRemoved: false,
  note: null,
});
const costs = [
  cost("d1-preparation", "other", null),
  cost("d1-breakfast", "meal", null),
  cost("departure", "transport", 48600),
  cost("d1-activity", "ticket", 6000),
  cost("d1-taxi", "local_transport", 8000),
  cost("d1-lunch", "meal", 26000),
  cost("d1-optional", "ticket", null),
  cost("d1-rest", "other", 12000),
  cost("d1-hotel", "accommodation", 28000),
  cost("d2-preparation", "other", null),
  cost("d2-breakfast", "meal", null),
  cost("d2-activity", "ticket", null),
  cost("d2-lunch", "meal", null),
  cost("d2-rest", "other", null),
  cost("return", "transport", null),
];

const created = await api("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    originalRequest: "阶段09验收：两天长沙预算，旧计划不套用新需求。",
  }),
});
const tripId = created.trip.id;
await api(`/api/trips/${tripId}/request`, {
  method: "PATCH",
  body: JSON.stringify({
    expectedRequestRevision: 1,
    request: requestSnapshot,
  }),
});
await api(`/api/trips/${tripId}/request/confirm`, {
  method: "POST",
  body: JSON.stringify({ expectedRequestRevision: 2 }),
});

process.env.DATABASE_URL = databaseUrl;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});
const seededPlan = await prisma.planVersion.create({
  data: {
    tripId,
    versionNumber: 1,
    requestRevision: 2,
    requestSnapshot: JSON.stringify(requestSnapshot),
    events: JSON.stringify(events),
    costs: JSON.stringify(costs),
    pendingItems: JSON.stringify([
      {
        id: "price",
        category: "price",
        title: "确认主要费用",
        reason: "本阶段没有实时价格依据。",
        requiredBefore: dates.startDate,
      },
    ]),
    validationResults: JSON.stringify({
      status: "valid",
      errors: [],
      warnings: [],
    }),
    requirementUpToDate: true,
  },
});
await prisma.trip.update({
  where: { id: tripId },
  data: {
    currentPlanVersionId: seededPlan.id,
    status: "planned",
    title: "长沙预算验收",
  },
});

await api(`/api/trips/${tripId}/request`, {
  method: "PATCH",
  body: JSON.stringify({
    expectedRequestRevision: 2,
    request: {
      ...requestSnapshot,
      travelerCount: 4,
      budgetAmountCents: 300000,
    },
  }),
});

const result = {
  executedAt: new Date().toISOString(),
  baseUrl,
  planSeededDirectlyWithoutAi: true,
  latestRequirementChangedWithoutConfirmation: true,
  tripId,
  temporaryTripDeleted: false,
  checks: {},
};

let browser;
try {
  await api(`/api/trips/${tripId}/plans`);
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(`${baseUrl}/trips/${tripId}`);
  await page.getByRole("heading", { name: /计划版本 1/ }).waitFor();
  result.checks.stalePlanVisible = await page
    .getByText("当前计划待更新")
    .first()
    .isVisible();
  result.checks.oldSnapshotSummaryVisible = await page
    .getByText(/预算目标 1300 元（全程总预算）｜预计 1286 元｜有未知金额，暂不能判断/)
    .isVisible();

  await page.getByRole("tab", { name: "预算" }).click();
  await page.getByText("1286 元").first().waitFor({ state: "visible" });
  result.checks.budgetTotalVisible = await page
    .getByText("1286 元")
    .first()
    .isVisible();
  result.checks.perPersonAndFactorsVisible = await page
    .getByText(/人均 643 元｜2 人｜1 间房｜1 晚/)
    .isVisible();
  result.checks.unknownNotCountedAsZero = await page
    .getByText("未知金额 9 项不计入合计")
    .isVisible();

  await page.getByRole("button", { name: /可选城市展览/ }).click();
  await page.getByLabel("单价（元，留空表示未知）").fill("10");
  await page.getByLabel("区间上限（元，可选）").fill("90");
  await page.getByLabel("已支付").check();
  await page.getByRole("button", { name: "确认金额" }).click();
  await page.getByRole("heading", { name: /计划版本 2/ }).waitFor();
  result.checks.rangeOverspendPossible = await page
    .getByText("可能超支")
    .first()
    .isVisible();
  result.checks.rangeTotalVisible = await page
    .getByText(/1296–1376 元（区间）/)
    .first()
    .isVisible();
  result.checks.paidVisible = await page
    .getByText(/已支付 10 元/)
    .first()
    .isVisible();

  await page.reload();
  await page.getByRole("heading", { name: /计划版本 2/ }).waitFor();
  await page.getByRole("tab", { name: "预算" }).click();
  result.checks.confirmedAmountSurvivesReload = await page
    .getByText(/1296–1376 元（区间）/)
    .first()
    .isVisible();

  await page.getByRole("tab", { name: "每日时间轴" }).click();
  await page.getByRole("button", { name: /可选城市展览/ }).click();
  await page.getByRole("button", { name: "移除安排" }).click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("heading", { name: /计划版本 3/ }).waitFor();
  await page.getByRole("tab", { name: "预算" }).click();
  result.checks.removedEventCostPreserved = await page
    .getByText("安排已移除，费用保留")
    .first()
    .isVisible();
  result.checks.removedEventStillCounted = await page
    .getByText(/1296–1376 元（区间）/)
    .first()
    .isVisible();

  await page.getByRole("button", { name: /早餐/ }).first().click();
  await page.getByLabel("单价（元，留空表示未知）").fill("50");
  await page.getByRole("button", { name: "确认金额" }).click();
  await page.getByRole("heading", { name: /计划版本 4/ }).waitFor();
  result.checks.definiteOverspendVisible = await page
    .getByText("确定超支")
    .first()
    .isVisible();

  const plansResponse = await api(`/api/trips/${tripId}/plans`);
  const currentPlan = plansResponse.plans[0];
  const optionalCost = currentPlan.costs.find(
    (item) => item.id === "cost-d1-optional",
  );
  result.checks.currentVersionInheritsOldSnapshot =
    currentPlan.versionNumber === 4 &&
    currentPlan.requestRevision === 2 &&
    currentPlan.requestSnapshot.travelerCount === 2 &&
    currentPlan.requestSnapshot.budgetAmountCents === 130000 &&
    currentPlan.requirementUpToDate === false;
  result.checks.removedCostFieldsPersist =
    optionalCost.eventRemoved === true &&
    optionalCost.unitAmountCents === 1000 &&
    optionalCost.unitAmountMaxCents === 9000 &&
    optionalCost.paymentStatus === "paid" &&
    optionalCost.certainty === "user_confirmed";

  result.checks.historicalCostEditRejected =
    (await apiStatus(
      `/api/trips/${tripId}/plans/2`,
      {
        method: "PATCH",
        body: JSON.stringify({
          type: "cost",
          costEdit: {
            costId: "cost-d1-breakfast",
            unit: "one_time",
            unitAmountCents: 5000,
            unitAmountMaxCents: null,
            quantity: null,
            paymentStatus: "not_paid",
          },
        }),
      },
    )) === 409;
  result.checks.duplicateCostEditRejected =
    (await apiStatus(
      `/api/trips/${tripId}/plans/4`,
      {
        method: "PATCH",
        body: JSON.stringify({
          type: "cost",
          costEdit: {
            costId: "cost-d1-breakfast",
            unit: "one_time",
            unitAmountCents: 5000,
            unitAmountMaxCents: null,
            quantity: null,
            paymentStatus: "not_paid",
          },
        }),
      },
    )) === 400;

  for (const viewport of [
    { width: 390, height: 844, name: "手机-390px" },
    { width: 768, height: 1024, name: "平板-768px" },
    { width: 1440, height: 1000, name: "桌面-1440px" },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const screenshotPath = path.join(
      evidenceDirectory,
      `阶段-09-预算-${viewport.name}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const imageBuffer = fs.readFileSync(screenshotPath);
    const imagePage = await browser.newPage();
    const imageMetrics = await imagePage.evaluate(async (dataUrl) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set();
      for (let index = 0; index < data.length; index += 40) {
        colors.add(`${data[index]}-${data[index + 1]}-${data[index + 2]}`);
      }
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        sampledUniqueColors: colors.size,
      };
    }, `data:image/png;base64,${imageBuffer.toString("base64")}`);
    await imagePage.close();

    result[viewport.name] = {
      screenshot: screenshotPath,
      noHorizontalOverflow: layout.scrollWidth <= layout.clientWidth + 1,
      screenshotExists: fs.existsSync(screenshotPath),
      nonBlank:
        imageMetrics.width === viewport.width &&
        imageMetrics.height > 0 &&
        imageMetrics.sampledUniqueColors > 20,
    };
  }

  const html = await page.content();
  result.checks.apiKeyAbsentFromPage = !/sk-[a-z0-9-]{12,}/i.test(html);
} finally {
  await browser?.close();
  await prisma.trip.delete({ where: { id: tripId } });
  await prisma.$disconnect();
  result.temporaryTripDeleted = true;
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(result, null, 2));

const passed =
  result.temporaryTripDeleted &&
  Object.values(result.checks).every((value) => value === true) &&
  ["手机-390px", "平板-768px", "桌面-1440px"].every((key) => {
    const viewport = result[key];
    return (
      viewport.noHorizontalOverflow &&
      viewport.screenshotExists &&
      viewport.nonBlank
    );
  });

if (!passed) {
  throw new Error(`阶段09验收存在失败项，证据已写入 ${evidencePath}`);
}
