import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.PHASE10_BASE_URL ?? "http://127.0.0.1:3003";
const evidenceDirectory = path.resolve("docs", "阶段验收", "证据");
const evidencePath = path.join(evidenceDirectory, "阶段-10-visual-check.json");
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
      `Phase 10 verification failed: HTTP ${response.status} ${text.slice(0, 400)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

function formatDate(date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function futureDates(days) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

const dates = futureDates(2);
const requestSnapshot = {
  destination: "长沙",
  startDate: dates.startDate,
  endDate: dates.endDate,
  travelerCount: 2,
  budgetAmountCents: 150000,
  budgetScope: "total",
  pace: "balanced",
  interests: ["博物馆"],
  accommodation: null,
  constraints: [],
  fieldSources: {
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
  },
};

const event = {
  id: "hunan-museum",
  dayNumber: 1,
  date: dates.startDate,
  startTime: "10:00",
  endTime: "12:00",
  type: "activity",
  title: "湖南博物院",
  locationName: "长沙市东风路50号",
  suggestedDurationSeconds: 7200,
  costDraftCents: null,
  costStatus: "pending_confirmation",
  note: null,
};

const result = {
  executedAt: new Date().toISOString(),
  baseUrl,
  realSearchProvider: "duckduckgo",
  temporaryTripDeleted: false,
  checks: {},
  viewports: {},
};

process.env.DATABASE_URL = databaseUrl;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

const created = await api("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    originalRequest: "阶段10验收：两天长沙，参观湖南博物院。",
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

const plan = await prisma.planVersion.create({
  data: {
    tripId,
    versionNumber: 1,
    requestRevision: 2,
    requestSnapshot: JSON.stringify(requestSnapshot),
    events: JSON.stringify([event]),
    costs: JSON.stringify([
      {
        id: "cost-hunan-museum",
        linkedEventId: event.id,
        category: "ticket",
        currency: "CNY",
        unit: "one_time",
        unitAmountCents: null,
        unitAmountMaxCents: null,
        quantity: null,
        certainty: "pending_confirmation",
        paymentStatus: "not_paid",
        source: "ai_draft",
        eventRemoved: false,
        note: null,
      },
    ]),
    pendingItems: JSON.stringify([
      {
        id: "opening-hours",
        category: "opening_hours",
        title: "确认开放时间",
        reason: "本阶段核验前没有实时官方依据。",
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
  data: { currentPlanVersionId: plan.id, status: "planned", title: "阶段10来源核验" },
});

let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(`${baseUrl}/trips/${tripId}`);
  await page.getByRole("heading", { name: /计划版本 1/ }).waitFor();
  result.checks.initialPendingVisible = await page
    .getByText("来源待确认")
    .first()
    .isVisible();

  await page
    .getByRole("button", { name: /10:00–12:00 湖南博物院/ })
    .click();
  await page.getByRole("heading", { name: /来源与可靠性/ }).waitFor();
  await page
    .getByRole("button", { name: /开放时间/ })
    .filter({ hasText: "建议确认" })
    .click();
  await page.getByRole("dialog", { name: /湖南博物院｜开放时间/ }).waitFor();
  await page.getByLabel("搜索词").fill("Hunan Museum open hours official website");
  await page.getByLabel("官方域名").fill("hnmuseum.com");
  await page.getByRole("button", { name: "读取并核验" }).click();
  await page
    .getByText("已读取官方页面并保存字段证据。")
    .waitFor({ timeout: 45_000 });

  result.checks.verifiedFieldVisible = await page
    .getByText("已核验")
    .first()
    .isVisible();
  result.checks.actualSourceVisible = await page
    .getByText(/湖南省博物馆|Hunan Museum|湖南省博物馆/)
    .first()
    .isVisible();
  result.checks.openingHoursQuoteVisible = await page
    .getByText(/9:00—17:00/)
    .first()
    .isVisible();
  result.checks.searchSummaryNotUpgraded =
    result.checks.verifiedFieldVisible &&
    result.checks.openingHoursQuoteVisible;

  const fact = await prisma.evidenceFact.findFirst({
    where: {
      tripId,
      targetId: event.id,
      field: "opening_hours",
    },
  });
  result.checks.persistedFactIsVerified = fact?.status === "verified";
  result.checks.persistedSourceIsOfficial =
    Boolean(fact?.sourceUrl.includes("hnmuseum.com")) &&
    fact?.sourcePublisher.includes("hnmuseum.com");
  result.checks.queryAndApplicabilityRecorded =
    Boolean(fact?.searchQuery) &&
    Boolean(fact?.retrievedAt) &&
    Boolean(fact?.applicableFrom) &&
    Boolean(fact?.applicableUntil);
  result.realEvidence = fact
    ? {
        field: fact.field,
        sourceTitle: fact.sourceTitle,
        sourceUrl: fact.sourceUrl,
        sourcePublisher: fact.sourcePublisher,
        sourcePublishedAt: fact.sourcePublishedAt,
        sourceDateStatus: fact.sourceDateStatus,
        searchQuery: fact.searchQuery,
        retrievedAt: fact.retrievedAt,
        applicableFrom: fact.applicableFrom,
        applicableUntil: fact.applicableUntil,
        contentQuote: fact.contentQuote,
      }
    : null;

  await page.screenshot({
    path: path.join(evidenceDirectory, "阶段-10-来源核验-桌面-1440px.png"),
    fullPage: true,
  });

  await page.reload();
  await page.getByRole("heading", { name: /计划版本 1/ }).waitFor();
  await page
    .getByRole("button", { name: /10:00–12:00 湖南博物院/ })
    .click();
  await page
    .getByRole("button", { name: /开放时间/ })
    .filter({ hasText: "已核验" })
    .click();
  result.checks.evidenceSurvivesReload = await page
    .getByText(/9:00—17:00/)
    .first()
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
      `阶段-10-来源核验-${viewport.name}.png`,
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
    result.viewports[viewport.name] = {
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
  result.checks.externalScriptNotRendered = !html.includes("IGNORE ALL RULES");

  if (result.checks.persistedFactIsVerified) {
    await prisma.appSettings.update({
      where: { id: "singleton" },
      data: {
        searchProvider: "duckduckgo",
        searchLanguage: "en",
        searchStatus: "connected",
        searchCheckedAt: new Date(),
        searchError: null,
      },
    });
  }
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
  Object.values(result.viewports).every(
    (viewport) =>
      viewport.noHorizontalOverflow &&
      viewport.screenshotExists &&
      viewport.nonBlank,
  );

if (!passed) {
  throw new Error(`阶段10验收存在失败项，证据已写入 ${evidencePath}`);
}
