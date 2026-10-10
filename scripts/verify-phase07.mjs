import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.PHASE07_BASE_URL ?? "http://127.0.0.1:3002";
const evidenceDirectory = path.resolve("docs", "阶段验收", "证据");
const evidencePath = path.join(evidenceDirectory, "阶段-07-visual-check.json");
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
      `Phase 07 verification failed: HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
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

const dates = futureDates(4);
const longDestination =
  "内蒙古自治区呼伦贝尔市额尔古纳国家湿地公园周边小镇";
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
  destination: longDestination,
  startDate: dates.startDate,
  endDate: dates.endDate,
  travelerCount: 4,
  budgetAmountCents: 600000,
  budgetScope: "total",
  pace: "packed",
  interests: ["湿地", "小镇"],
  accommodation: null,
  constraints: [],
  fieldSources,
};

const day = (dayNumber, type, title, startTime, endTime) => {
  const date = new Date(`${dates.startDate}T00:00:00`);
  date.setDate(date.getDate() + dayNumber - 1);
  return {
    id: `day-${dayNumber}-${type}`,
    dayNumber,
    date: formatDate(date),
    startTime,
    endTime,
    type,
    title,
    locationName: type === "preparation" ? null : `${longDestination}区域`,
    suggestedDurationSeconds: 3600,
    costDraftCents: type === "activity" ? 8000 : null,
    costStatus: type === "activity" ? "estimated" : "pending_confirmation",
    note: null,
  };
};

const events = [
  day(1, "departure_transport", "抵达目的地", "08:00", "10:00"),
  day(2, "activity", "草原湿地漫步", "09:00", "11:00"),
  day(3, "activity", "小镇骑马体验", "09:30", "11:30"),
  day(4, "return_transport", "第4天返程", "16:00", "18:00"),
];
const pendingItems = [
  {
    id: "route",
    category: "route",
    title: "确认小镇间交通",
    reason: "本阶段没有路线核验依据。",
    requiredBefore: dates.startDate,
  },
];
const validationResults = {
  status: "valid",
  errors: [],
  warnings: [],
};

const created = await api("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    originalRequest: "阶段07总览验收：四天长城市名基础行程，预算 6000 元。",
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
const plan = await prisma.planVersion.create({
  data: {
    tripId,
    versionNumber: 1,
    requestRevision: 2,
    requestSnapshot: JSON.stringify(requestSnapshot),
    events: JSON.stringify(events),
    pendingItems: JSON.stringify(pendingItems),
    validationResults: JSON.stringify(validationResults),
    requirementUpToDate: true,
  },
});
await prisma.trip.update({
  where: { id: tripId },
  data: {
    currentPlanVersionId: plan.id,
    status: "planned",
    title: "额尔古纳四天总览验收",
  },
});

const plansResponse = await api(`/api/trips/${tripId}/plans`);
const savedPlan = plansResponse.plans.find(
  (item) => item.versionNumber === 1,
);
const result = {
  executedAt: new Date().toISOString(),
  baseUrl,
  planSeededDirectlyWithoutAi: true,
  tripId,
  temporaryTripDeleted: false,
  savedValuesMatch: savedPlan.requestSnapshot.destination === longDestination &&
    savedPlan.requestSnapshot.travelerCount === 4 &&
    savedPlan.requestSnapshot.budgetAmountCents === 600000 &&
    savedPlan.events.length === 4 &&
    savedPlan.pendingItems.length === 1,
  checks: {},
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await page.goto(`${baseUrl}/trips/${tripId}`);
  await page.getByRole("heading", { name: /计划版本 1/ }).waitFor();
  await page.getByRole("button", { name: /第 4 天/ }).click();
  await page.getByRole("heading", { name: /第 4 天/ }).waitFor();

  await page.reload();
  await page.getByRole("heading", { name: /计划版本 1/ }).waitFor();
  await page.getByRole("button", { name: /第 4 天/ }).click();
  await page.getByRole("heading", { name: /第 4 天/ }).waitFor();
  result.checks.survivesReload = true;
  result.checks.longDestinationVisible = await page
    .getByText(longDestination)
    .first()
    .isVisible();
  result.checks.budgetTargetVisible = await page
    .getByText("预算目标 6000 元（全程总预算）")
    .isVisible();
  result.checks.costPendingVisible = await page
    .getByText("费用待核算")
    .isVisible();
  result.checks.noCalculatedTotalWording = !(await page
    .getByText("预计总费用")
    .count());
  result.checks.pendingItemVisible = await page
    .getByText("确认小镇间交通")
    .isVisible();

  for (const viewport of [
    { width: 390, height: 844, name: "手机-390px" },
    { width: 768, height: 1024, name: "平板-768px" },
    { width: 1440, height: 1000, name: "桌面-1440px" },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    const screenshotPath = path.join(
      evidenceDirectory,
      `阶段-07-行程总览-${viewport.name}.png`,
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
  await browser.close();
  await prisma.trip.delete({ where: { id: tripId } });
  await prisma.$disconnect();
  result.temporaryTripDeleted = true;
}

fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(evidencePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));

const passed =
  result.savedValuesMatch &&
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
  throw new Error(`阶段07验收存在失败项，证据已写入 ${evidencePath}`);
}
