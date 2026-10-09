import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const evidenceDirectory = path.join(
  process.cwd(),
  "docs",
  "阶段验收",
  "证据",
);
const baseUrl = process.env.PHASE06_BASE_URL ?? "http://127.0.0.1:3002";

function futureDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const format = (date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  return { startDate: format(start), endDate: format(end) };
}

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
    payload = null;
  }
  if (!response.ok) {
    throw new Error(
      `Phase 06 visual setup failed: HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return payload;
}

const created = await api("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    originalRequest: "阶段06视觉检查：两天长沙基础行程，预算 1500 元。",
  }),
});
const tripId = created.trip.id;
const dates = futureDates();
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

await api(`/api/trips/${tripId}/request`, {
  method: "PATCH",
  body: JSON.stringify({
    expectedRequestRevision: 1,
    request: {
      destination: "长沙",
      startDate: dates.startDate,
      endDate: dates.endDate,
      travelerCount: 2,
      budgetAmountCents: 150000,
      budgetScope: "total",
      pace: "balanced",
      interests: ["城市漫步"],
      accommodation: null,
      constraints: [],
      fieldSources,
    },
  }),
});
await api(`/api/trips/${tripId}/request/confirm`, {
  method: "POST",
  body: JSON.stringify({ expectedRequestRevision: 2 }),
});

const mockedPlan = {
  id: "phase06-visual-plan",
  tripId,
  versionNumber: 1,
  requestRevision: 2,
  requestSnapshot: {
    destination: "长沙",
    startDate: dates.startDate,
    endDate: dates.endDate,
    travelerCount: 2,
    budgetAmountCents: 150000,
    budgetScope: "total",
    pace: "balanced",
    interests: ["城市漫步"],
    accommodation: null,
    constraints: [],
    fieldSources: {},
  },
  events: [
    {
      id: "preparation",
      dayNumber: 1,
      date: dates.startDate,
      startTime: "07:30",
      endTime: "07:50",
      type: "preparation",
      title: "当日准备",
      locationName: null,
      suggestedDurationSeconds: 1200,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: null,
    },
    {
      id: "departure",
      dayNumber: 1,
      date: dates.startDate,
      startTime: "08:00",
      endTime: "10:00",
      type: "departure_transport",
      title: "前往长沙",
      locationName: "出发站",
      suggestedDurationSeconds: 7200,
      costDraftCents: 12000,
      costStatus: "estimated",
      note: "班次与价格待确认",
    },
    {
      id: "walk",
      dayNumber: 1,
      date: dates.startDate,
      startTime: "10:30",
      endTime: "12:00",
      type: "activity",
      title: "湘江边散步",
      locationName: "湘江风光带",
      suggestedDurationSeconds: 5400,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: null,
    },
    {
      id: "lunch",
      dayNumber: 1,
      date: dates.startDate,
      startTime: "12:30",
      endTime: "13:30",
      type: "meal",
      title: "午餐",
      locationName: "市中心餐饮区",
      suggestedDurationSeconds: 3600,
      costDraftCents: 6000,
      costStatus: "estimated",
      note: null,
    },
    {
      id: "rest",
      dayNumber: 1,
      date: dates.startDate,
      startTime: "14:00",
      endTime: "14:30",
      type: "rest",
      title: "休息",
      locationName: "住宿区域",
      suggestedDurationSeconds: 1800,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: null,
    },
    {
      id: "hotel",
      dayNumber: 1,
      date: dates.startDate,
      startTime: "20:00",
      endTime: "22:00",
      type: "accommodation",
      title: "住宿区域",
      locationName: "市中心住宿区域",
      suggestedDurationSeconds: 7200,
      costDraftCents: 30000,
      costStatus: "estimated",
      note: null,
    },
    {
      id: "return-preparation",
      dayNumber: 2,
      date: dates.endDate,
      startTime: "16:00",
      endTime: "16:20",
      type: "preparation",
      title: "返程前检查",
      locationName: null,
      suggestedDurationSeconds: 1200,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: null,
    },
    {
      id: "return",
      dayNumber: 2,
      date: dates.endDate,
      startTime: "17:00",
      endTime: "19:00",
      type: "return_transport",
      title: "返程",
      locationName: "长沙站",
      suggestedDurationSeconds: 7200,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: "车次待确认",
    },
  ],
  pendingItems: [
    {
      id: "ticket",
      category: "transport_ticket",
      title: "确认去返程车票",
      reason: "本阶段没有实时余票依据。",
      requiredBefore: dates.startDate,
    },
  ],
  validationResults: {
    status: "valid",
    errors: [],
    warnings: [],
  },
  requirementUpToDate: true,
  isCurrent: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
});
const result = {
  tripId,
  temporaryTripDeleted: false,
  generationResponseMockedForVisualCheck: true,
};

try {
  await page.route(`**/api/trips/${tripId}/plans/generate`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plan: mockedPlan }),
    });
  });
  await page.goto(`${baseUrl}/trips/${tripId}`);
  await page.getByRole("button", { name: "生成基础行程" }).click();
  await page.getByRole("heading", { name: "计划版本 1" }).waitFor();

  for (const viewport of [
    { width: 390, height: 844, name: "手机-390px" },
    { width: 768, height: 1024, name: "平板-768px" },
    { width: 1440, height: 1000, name: "桌面-1440px" },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.waitForTimeout(300);

    const screenshotPath = path.join(
      evidenceDirectory,
      `阶段-06-基础行程-${viewport.name}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const layout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    const imagePage = await browser.newPage();
    const imageDataUrl = `data:image/png;base64,${fs
      .readFileSync(screenshotPath)
      .toString("base64")}`;
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
    }, imageDataUrl);
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
  result.apiKeyAbsentFromPage = !/sk-[a-z0-9-]{12,}/i.test(html);
  result.estimatedCostVisible = html.includes("估算");
  result.pendingItemsVisible = html.includes("确认去返程车票");
} finally {
  await browser.close();
  await api(`/api/trips/${tripId}`, { method: "DELETE" });
  result.temporaryTripDeleted = true;
}

fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDirectory, "阶段-06-visual-check.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(result, null, 2));

const allPassed = Object.entries(result).every(([key, value]) => {
  if (key === "tripId" || key === "generationResponseMockedForVisualCheck") {
    return true;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    return (
      value.noHorizontalOverflow === true &&
      value.screenshotExists === true &&
      value.nonBlank === true
    );
  }
  return false;
});

if (!allPassed) {
  process.exit(1);
}
