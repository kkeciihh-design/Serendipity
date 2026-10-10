import http from "node:http";
import { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import {
  DEFAULT_BASE_PROMPT,
} from "../../lib/prompt-defaults";

const testApiKey = "sk-e2e-secret-value";

let aiServer: http.Server;
let aiBaseUrl: string;

function extractChallenge(body: string) {
  const match = body.match(/SRD-[a-z0-9]{8}/i);
  return match?.[0] ?? "SRD-unknown";
}

test.beforeAll(async () => {
  aiServer = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.resume();
    request.on("end", () => {
      const challenge = extractChallenge(body);
      const authorization = request.headers.authorization ?? "";
      if (authorization !== `Bearer ${testApiKey}`) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid key" } }));
        return;
      }

      if (request.url?.includes("model-missing")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "The model e2e-model was not found" },
          }),
        );
        return;
      }

      if (request.url?.endsWith("/models")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              { id: "e2e-model" },
              { id: "e2e-alt-model" },
            ],
          }),
        );
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: challenge } }],
        }),
      );
    });
  });

  await new Promise<void>((resolve) => {
    aiServer.listen(0, "127.0.0.1", resolve);
  });
  const address = aiServer.address() as AddressInfo;
  aiBaseUrl = `http://127.0.0.1:${address.port}/v1`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    aiServer.close(() => resolve());
  });
});

test("settings APIs are protected before password setup", async ({
  request,
}) => {
  const response = await request.get("/api/settings");
  expect(response.status()).toBe(401);

  const tripsResponse = await request.get("/api/trips");
  expect(tripsResponse.status()).toBe(200);

  const searchTestResponse = await request.post(
    "/api/settings/search/test",
    {
      data: { provider: "duckduckgo", language: "en" },
    },
  );
  expect(searchTestResponse.status()).toBe(401);

  const searchSaveResponse = await request.post("/api/settings/search", {
    data: { provider: "duckduckgo", language: "en" },
  });
  expect(searchSaveResponse.status()).toBe(401);
});

test("configures a personal password and a working AI connection", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByLabel("个人密码").first().fill("e2e-password-123");
  await page.getByLabel("确认个人密码").fill("e2e-password-123");
  await page.getByRole("button", { name: "设置密码" }).click();
  await expect(page.getByRole("heading", { name: "AI 基本连接" })).toBeVisible();

  await page.getByLabel("上游格式").selectOption("openai-chat-completions");
  await page.getByLabel("Base URL").fill(aiBaseUrl);
  await page.getByLabel("模型").fill("e2e-model");
  await page.locator("#ai-api-key").fill("wrong-key");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("服务拒绝了这个 API Key，请核对密钥权限。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存配置" })).toBeDisabled();

  await page.locator("#ai-api-key").fill(testApiKey);
  await page.getByRole("button", { name: "获取模型" }).click();
  await expect(page.getByText("已获取 2 个模型。")).toBeVisible();
  await page.getByLabel("选择模型").selectOption("e2e-model");
  await expect(page.locator("#ai-model")).toHaveValue("e2e-model");

  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText(/连接测试通过/)).toBeVisible();
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("AI 配置已保存，重启应用后仍可使用。")).toBeVisible();
  await expect(page.getByText("已配置，末尾 alue")).toBeVisible();
  await expect(page.getByRole("heading", { name: "来源搜索" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存搜索配置" }),
  ).toBeDisabled();

  const pageHtml = await page.content();
  expect(pageHtml).not.toContain(testApiKey);

  const settingsResponse = await page.request.get("/api/settings");
  const settingsText = await settingsResponse.text();
  expect(settingsResponse.status()).toBe(200);
  expect(settingsText).not.toContain(testApiKey);
});

test("prompts save, restore defaults, and leave trips unchanged", async ({
  page,
  request,
}) => {
  const tripResponse = await request.post("/api/trips", {
    data: {
      originalRequest: "Prompt 保存测试：这趟旅行不能被改写。",
    },
  });
  const { trip } = (await tripResponse.json()) as {
    trip: { id: string; originalRequest: string };
  };

  await page.goto("/settings");
  await page.getByLabel("个人密码").fill("e2e-password-123");
  await page.getByRole("button", { name: "进入设置" }).click();
  await expect(page.getByRole("heading", { name: "Prompt 高级选项" })).toBeVisible();

  await page.getByLabel("基础 Prompt").fill("测试基础 Prompt");
  await page.getByLabel("系统 Prompt").fill("测试系统 Prompt");
  await page.getByRole("button", { name: "保存 Prompt" }).click();
  await expect(page.getByText("Prompt 已保存，不会改写已有旅行。")).toBeVisible();
  await expect(page.getByText("版本 2")).toBeVisible();

  await page.getByRole("button", { name: "恢复默认" }).click();
  await expect(page.getByLabel("基础 Prompt")).toHaveValue(DEFAULT_BASE_PROMPT);
  await page.getByRole("button", { name: "撤销恢复" }).click();
  await expect(page.getByLabel("基础 Prompt")).toHaveValue("测试基础 Prompt");

  await page.getByRole("button", { name: "恢复默认" }).click();
  await page.getByRole("button", { name: "保存 Prompt" }).click();
  await expect(page.getByText("Prompt 已保存，不会改写已有旅行。")).toBeVisible();
  await expect(page.getByText("版本 3")).toBeVisible();

  const unchangedTripResponse = await request.get(`/api/trips/${trip.id}`);
  const unchangedTrip = (await unchangedTripResponse.json()) as {
    trip: { originalRequest: string };
  };
  expect(unchangedTrip.trip.originalRequest).toBe(
    "Prompt 保存测试：这趟旅行不能被改写。",
  );
});

test("logout requires the correct password again", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("个人密码").fill("e2e-password-123");
  await page.getByRole("button", { name: "进入设置" }).click();
  await page.getByRole("button", { name: "退出设置" }).click();
  await expect(page.getByRole("heading", { name: "验证个人密码" })).toBeVisible();

  const settingsResponse = await page.request.get("/api/settings");
  expect(settingsResponse.status()).toBe(401);

  await page.getByLabel("个人密码").fill("wrong-password");
  await page.getByRole("button", { name: "进入设置" }).click();
  await expect(page.getByText("个人密码不正确。")).toBeVisible();

  await page.getByLabel("个人密码").fill("e2e-password-123");
  await page.getByRole("button", { name: "进入设置" }).click();
  await expect(page.getByRole("heading", { name: "AI 基本连接" })).toBeVisible();
});
