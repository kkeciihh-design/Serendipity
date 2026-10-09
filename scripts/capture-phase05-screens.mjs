import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const evidenceDirectory = path.join(
  process.cwd(),
  "docs",
  "阶段验收",
  "证据",
);
const baseUrl = process.env.PHASE05_BASE_URL ?? "http://127.0.0.1:3002";

function futureDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
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
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(
      `Phase 05 visual setup failed: HTTP ${response.status} ${text.slice(0, 300)}`,
    );
  }
  return payload;
}

const createPayload = await api("/api/trips", {
  method: "POST",
  body: JSON.stringify({
    originalRequest: "阶段05视觉检查：周末去长沙，两个人，预算 1500 元。",
  }),
});
const tripId = createPayload.trip.id;
const dates = futureDates();
const fieldSources = {
  destination: "ai_extracted",
  startDate: "program_derived",
  endDate: "program_derived",
  travelerCount: "ai_extracted",
  budgetAmountCents: "ai_extracted",
  budgetScope: "default_assumption",
  pace: "default_assumption",
  interests: "ai_extracted",
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
      interests: ["自然风景"],
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

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
});
const result = {
  tripId,
  temporaryTripDeleted: false,
};

try {
  await page.goto(`${baseUrl}/trips/${tripId}`);
  await page.getByRole("heading", { name: /修订 2｜已确认/ }).waitFor();

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
      `阶段-05-需求确认-${viewport.name}.png`,
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
      const data = context.getImageData(0, 0, canvas.width, canvas.height)
        .data;
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
} finally {
  await browser.close();
  await api(`/api/trips/${tripId}`, { method: "DELETE" });
  result.temporaryTripDeleted = true;
}

fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDirectory, "阶段-05-visual-check.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify(result, null, 2));

const allPassed = Object.entries(result).every(([key, value]) => {
  if (key === "tripId") {
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
