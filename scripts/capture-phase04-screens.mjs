import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const projectRoot = process.cwd();
const testDataDirectory = path.join(projectRoot, "test-data", "phase04");
const baseUrl = "http://127.0.0.1:3002";
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const evidenceDirectory = path.join(
  projectRoot,
  "docs",
  "阶段验收",
  "证据",
);
const testPassword = "phase04-integration-password";
const testApiKey = "phase04-integration-key";

if (!fs.existsSync(path.join(testDataDirectory, "data", "serendipity.db"))) {
  throw new Error("Phase 04 test data is missing. Run npm run verify:phase04 first.");
}

function startServer() {
  return spawn(process.execPath, [nextCli, "start", "-p", "3002"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      SERENDIPITY_DATA_DIR: testDataDirectory,
    },
    stdio: "inherit",
  });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/trips`);
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still binding to the port.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Screenshot server did not become ready.");
}

const server = startServer();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const result = {};

try {
  await waitForServer();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await page.goto(`${baseUrl}/settings`);
  await page.getByLabel("个人密码").fill(testPassword);
  await page.getByRole("button", { name: "进入设置" }).click();
  await page.getByRole("heading", { name: "AI 基本连接" }).waitFor();

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
      `阶段-04-设置-${viewport.name}.png`,
    );
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
    const overflow = await page.evaluate(() => ({
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
      const data = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
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
      noHorizontalOverflow: overflow.scrollWidth <= overflow.clientWidth + 1,
      screenshotExists: fs.existsSync(screenshotPath),
      nonBlank:
        imageMetrics.width === viewport.width &&
        imageMetrics.height > 0 &&
        imageMetrics.sampledUniqueColors > 20,
    };
  }

  const pageHtml = await page.content();
  result.apiKeyAbsentFromPage = !pageHtml.includes(testApiKey);
} finally {
  await browser.close();
  await stopServer(server);
}

fs.mkdirSync(evidenceDirectory, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDirectory, "阶段-04-visual-check.json"),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));

const allPassed = Object.values(result).every((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  return (
    value.noHorizontalOverflow === true &&
    value.screenshotExists === true &&
    value.nonBlank === true
  );
});

if (!allPassed) {
  process.exit(1);
}
