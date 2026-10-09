import { expect, test } from "@playwright/test";

function futureDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const format = (date: Date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  return { startDate: format(start), endDate: format(end) };
}

test("requirement summary saves, confirms, and requires reconfirmation after edits", async ({
  page,
  request,
}) => {
  const createResponse = await request.post("/api/trips", {
    data: { originalRequest: "周末去长沙，两个人，预算 1500 元。" },
  });
  const { trip } = (await createResponse.json()) as {
    trip: { id: string };
  };
  const dates = futureDates();

  const draftResponse = await request.patch(`/api/trips/${trip.id}/request`, {
    data: {
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
        fieldSources: {
          destination: "ai_extracted",
          startDate: "program_derived",
          endDate: "program_derived",
          travelerCount: "ai_extracted",
          budgetAmountCents: "ai_extracted",
          budgetScope: "ai_extracted",
          pace: "default_assumption",
          interests: "ai_extracted",
          accommodation: "unspecified",
          constraints: "unspecified",
        },
      },
    },
  });
  expect(draftResponse.status()).toBe(200);

  await page.goto(`/trips/${trip.id}`);
  await expect(page.getByRole("heading", { name: /修订 2｜待确认/ })).toBeVisible();
  await expect(page.locator("#request-destination")).toHaveValue("长沙");
  await expect(page.locator("#request-start-date")).toHaveValue(dates.startDate);
  await expect(page.locator("#request-budget")).toHaveValue("1500");
  await expect(page.getByRole("heading", { name: "默认假设" })).toBeVisible();
  await expect(page.getByText(/原话没有说明节奏/)).toBeVisible();

  await page.getByRole("button", { name: "确认修订 2" }).click();
  await expect(page.getByRole("heading", { name: /修订 2｜已确认/ })).toBeVisible();
  await expect(
    page.getByText(/修订 2 已确认，可作为阶段 06 生成计划/),
  ).toBeVisible();

  await page.locator("#request-destination").fill("长沙和株洲");
  await expect(page.getByText("保存后将重新确认")).toBeVisible();
  await page.getByRole("button", { name: "保存需求修订" }).click();
  await expect(
    page.getByText(/需求修订 3 已保存，需要重新确认/),
  ).toBeVisible();

  const staleConfirmResponse = await request.post(
    `/api/trips/${trip.id}/request/confirm`,
    { data: { expectedRequestRevision: 2 } },
  );
  expect(staleConfirmResponse.status()).toBe(409);
  const staleConfirm = (await staleConfirmResponse.json()) as { error: string };
  expect(staleConfirm.error).toContain("旧页面的确认请求");

  await page.getByRole("button", { name: "确认修订 3" }).click();
  await expect(page.getByRole("heading", { name: /修订 3｜已确认/ })).toBeVisible();

  await page.reload();
  await expect(page.locator("#request-destination")).toHaveValue("长沙和株洲");
  await expect(page.getByRole("heading", { name: /修订 3｜已确认/ })).toBeVisible();
});

test("shows clear AI failures and invalid request handling", async ({
  page,
  request,
}) => {
  const createResponse = await request.post("/api/trips", {
    data: { originalRequest: "缺目的地的周末旅行" },
  });
  const { trip } = (await createResponse.json()) as {
    trip: { id: string };
  };

  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("button", { name: "AI 理解需求" }).click();
  await expect(
    page.getByText(
      /AI 请求失败|无法连接到 AI 服务|AI 服务尚未配置|模型没有返回 JSON/,
    ),
  ).toBeVisible();
  await expect(page.locator("#trip-request-original")).toHaveValue(
    "缺目的地的周末旅行",
  );

  const draftResponse = await request.patch(`/api/trips/${trip.id}/request`, {
    data: {
      expectedRequestRevision: 1,
      request: {
        destination: null,
        startDate: "2020-01-01",
        endDate: "2020-01-02",
        travelerCount: 1,
        budgetAmountCents: null,
        budgetScope: null,
        pace: "balanced",
        interests: [],
        accommodation: null,
        constraints: [],
        fieldSources: {
          destination: "unspecified",
          startDate: "ai_extracted",
          endDate: "ai_extracted",
          travelerCount: "default_assumption",
          budgetAmountCents: "unspecified",
          budgetScope: "unspecified",
          pace: "default_assumption",
          interests: "unspecified",
          accommodation: "unspecified",
          constraints: "unspecified",
        },
      },
    },
  });
  expect(draftResponse.status()).toBe(400);
  const invalid = (await draftResponse.json()) as { error: string };
  expect(invalid.error).toContain("出发日期已经过去");
});

test("a late extraction result does not overwrite unsaved page edits", async ({
  page,
  request,
}) => {
  const createResponse = await request.post("/api/trips", {
    data: { originalRequest: "周末去长沙，预算 1500 元。" },
  });
  const { trip } = (await createResponse.json()) as {
    trip: { id: string };
  };
  const dates = futureDates();
  let releaseLateResult: (() => void) | undefined;
  const lateResultGate = new Promise<void>((resolve) => {
    releaseLateResult = resolve;
  });

  await page.route(`**/api/trips/${trip.id}/request/extract`, async (route) => {
    await lateResultGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        request: {
          id: "late-result",
          tripId: trip.id,
          originalRequest: "周末去长沙，预算 1500 元。",
          requestRevision: 2,
          extractedRequest: {
            destination: "长沙",
            startDate: dates.startDate,
            endDate: dates.endDate,
            travelerCount: 1,
            budgetAmountCents: 150000,
            budgetScope: "total",
            pace: "balanced",
            interests: [],
            accommodation: null,
            constraints: [],
            fieldSources: {
              destination: "ai_extracted",
              startDate: "program_derived",
              endDate: "program_derived",
              travelerCount: "default_assumption",
              budgetAmountCents: "ai_extracted",
              budgetScope: "default_assumption",
              pace: "default_assumption",
              interests: "unspecified",
              accommodation: "unspecified",
              constraints: "unspecified",
            },
          },
          fieldSources: null,
          defaultAssumptions: [],
          pendingQuestions: [],
          confirmedRequest: null,
          confirmedRevision: null,
          confirmedAt: null,
          updatedAt: new Date().toISOString(),
        },
      }),
    });
  });

  await page.goto(`/trips/${trip.id}`);
  await page.getByRole("button", { name: "AI 理解需求" }).click();
  await page.locator("#request-destination").fill("长沙和株洲");
  await expect(page.getByText("保存后将重新确认")).toBeVisible();

  const preparedDraft = await request.patch(`/api/trips/${trip.id}/request`, {
    data: {
      expectedRequestRevision: 1,
      request: {
        destination: "长沙",
        startDate: dates.startDate,
        endDate: dates.endDate,
        travelerCount: 1,
        budgetAmountCents: 150000,
        budgetScope: "total",
        pace: "balanced",
        interests: [],
        accommodation: null,
        constraints: [],
        fieldSources: {
          destination: "ai_extracted",
          startDate: "program_derived",
          endDate: "program_derived",
          travelerCount: "default_assumption",
          budgetAmountCents: "ai_extracted",
          budgetScope: "default_assumption",
          pace: "default_assumption",
          interests: "unspecified",
          accommodation: "unspecified",
          constraints: "unspecified",
        },
      },
    },
  });
  expect(preparedDraft.status()).toBe(200);

  releaseLateResult?.();

  await expect(page.locator("#request-destination")).toHaveValue("长沙和株洲");
  await expect(
    page.getByText(/屏幕上的编辑未被覆盖，请核对后保存/),
  ).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("heading", { name: /修订 2｜待确认/ })).toBeVisible();

  await page.getByRole("button", { name: "保存需求修订" }).click();
  await expect(
    page.getByText(/需求修订 3 已保存，需要重新确认/),
  ).toBeVisible();
  await expect(page.locator("#request-destination")).toHaveValue("长沙和株洲");
});
