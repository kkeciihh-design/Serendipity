import { expect, test, type Page } from "@playwright/test";

function futureDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const format = (date: Date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  return { startDate: format(start), endDate: format(end) };
}

async function createConfirmedTrip(page: Page) {
  const createResponse = await page.request.post("/api/trips", {
    data: { originalRequest: "阶段06浏览器验收：两天长沙基础行程。" },
  });
  expect(createResponse.status()).toBe(201);
  const { trip } = (await createResponse.json()) as {
    trip: { id: string };
  };
  const dates = futureDates();
  const draftResponse = await page.request.patch(`/api/trips/${trip.id}/request`, {
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
        interests: ["城市漫步"],
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
      },
    },
  });
  expect(draftResponse.status()).toBe(200);
  const confirmResponse = await page.request.post(
    `/api/trips/${trip.id}/request/confirm`,
    { data: { expectedRequestRevision: 2 } },
  );
  expect(confirmResponse.status()).toBe(200);
  return trip.id;
}

function mockedPlan(tripId: string, versionNumber = 1) {
  const dates = futureDates();
  return {
    id: `plan-${versionNumber}`,
    tripId,
    versionNumber,
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
        id: "activity",
        dayNumber: 1,
        date: dates.startDate,
        startTime: "11:00",
        endTime: "13:00",
        type: "activity",
        title: "湘江边散步",
        locationName: "湘江风光带",
        suggestedDurationSeconds: 7200,
        costDraftCents: null,
        costStatus: "pending_confirmation",
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
        note: null,
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
}

test("shows a generated basic plan and keeps costs visibly unverified", async ({
  page,
}) => {
  const tripId = await createConfirmedTrip(page);
  await page.route(`**/api/trips/${tripId}/plans/generate`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plan: mockedPlan(tripId) }),
    });
  });

  await page.goto(`/trips/${tripId}`);
  await expect(
    page.getByRole("heading", { name: /尚无基础计划/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成基础行程" }).click();

  await expect(
    page.getByRole("heading", { name: /计划版本 1/ }),
  ).toBeVisible();
  await expect(page.getByText("依据需求修订 2 的确认快照生成")).toBeVisible();
  await expect(page.getByText("费用待核算")).toBeVisible();
  await expect(page.getByText("前往长沙")).toBeVisible();
  await expect(page.getByText("湘江边散步")).toBeVisible();
  await expect(page.getByText("120 元｜估算")).toBeVisible();
  await expect(page.getByText("待确认｜待确认").first()).toBeVisible();
  await expect(page.getByText("确认去返程车票")).toBeVisible();
  await expect(page.getByText(/计划版本 1 已保存/)).toBeVisible();

  await page.locator("#request-destination").fill("株洲");
  await expect(page.getByText("保存后将重新确认")).toBeVisible();
  await expect(page.getByText("需求修改未保存")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成基础行程" }),
  ).toBeDisabled();
});

test("overview switches days and plan versions without mixing request snapshots", async ({
  page,
}) => {
  const tripId = await createConfirmedTrip(page);
  const dates = futureDates();
  const fourDayEnd = new Date(`${dates.endDate}T00:00:00`);
  fourDayEnd.setDate(fourDayEnd.getDate() + 2);
  const format = (date: Date) =>
    `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
  const fourDayDates = {
    startDate: dates.startDate,
    endDate: format(fourDayEnd),
  };
  const longDestination =
    "内蒙古自治区呼伦贝尔市额尔古纳国家湿地公园周边小镇";
  const snapshotFor = (destination: string) => ({
    destination,
    startDate: fourDayDates.startDate,
    endDate: fourDayDates.endDate,
    travelerCount: 4,
    budgetAmountCents: 600000,
    budgetScope: "total",
    pace: "packed",
    interests: ["湿地", "小镇"],
    accommodation: null,
    constraints: [],
    fieldSources: {},
  });
  const event = (
    id: string,
    dayNumber: number,
    type: string,
    title: string,
  ) => {
    const date = new Date(`${fourDayDates.startDate}T00:00:00`);
    date.setDate(date.getDate() + dayNumber - 1);
    return {
      id,
      dayNumber,
      date: format(date),
      startTime: "09:00",
      endTime: "10:30",
      type,
      title,
      locationName: null,
      suggestedDurationSeconds: 5400,
      costDraftCents: null,
      costStatus: "pending_confirmation",
      note: null,
    };
  };
  const overviewPlan = (versionNumber: number, destination: string) => ({
    id: `overview-plan-${versionNumber}`,
    tripId,
    versionNumber,
    requestRevision: versionNumber === 1 ? 2 : 3,
    requestSnapshot: snapshotFor(destination),
    events: [
      event("departure", 1, "departure_transport", "抵达目的地"),
      event("wetland", 2, "activity", "草原湿地漫步"),
      event("town", 3, "activity", "小镇骑马体验"),
      event("return", 4, "return_transport", "第4天返程"),
    ],
    pendingItems: [
      {
        id: "route",
        category: "route",
        title: "确认小镇间交通",
        reason: "本阶段没有路线核验依据。",
        requiredBefore: fourDayDates.startDate,
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
  });

  await page.route(`**/api/trips/${tripId}/plans/generate`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      expectedRequestRevision: number;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan:
          body.expectedRequestRevision === 2
            ? overviewPlan(1, longDestination)
            : overviewPlan(2, "株洲"),
      }),
    });
  });

  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "生成基础行程" }).click();
  await expect(
    page.getByRole("heading", { name: /计划版本 1/ }),
  ).toBeVisible();
  await expect(
    page.getByText(
      `${fourDayDates.startDate} 至 ${fourDayDates.endDate}`,
    ),
  ).toBeVisible();
  await expect(page.getByText("4 人").first()).toBeVisible();
  await expect(
    page
      .getByText("节奏", { exact: true })
      .locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("紧凑");
  await expect(page.getByText("预算目标 6000 元（全程总预算）")).toBeVisible();
  await expect(page.getByText("预计总费用")).toHaveCount(0);

  await page.getByRole("button", { name: /第 4 天/ }).click();
  await expect(
    page.getByRole("heading", { name: /第 4 天/ }),
  ).toBeVisible();
  await expect(page.getByText("第4天返程")).toBeVisible();

  await page.locator("#request-destination").fill("株洲");
  await page.getByRole("button", { name: "保存需求修订" }).click();
  await expect(page.getByText(/需求修订 3 已保存/)).toBeVisible();
  await expect(page.getByText("当前计划待更新")).toBeVisible();
  await expect(page.getByText(longDestination).first()).toBeVisible();
  await expect(page.getByText("确认小镇间交通")).toBeVisible();

  await page.getByRole("button", { name: "确认修订 3" }).click();
  await expect(page.getByText(/修订 3 已确认/)).toBeVisible();
  await expect(page.getByText(longDestination).first()).toBeVisible();
  await expect(page.getByText("当前计划待更新")).toBeVisible();

  await page.getByRole("button", { name: "生成基础行程" }).click();
  await expect(
    page.getByRole("heading", { name: /计划版本 2/ }),
  ).toBeVisible();
  await expect(page.getByText("株洲").first()).toBeVisible();
  await expect(page.getByText("需求依据当前有效")).toBeVisible();
  await expect(page.getByRole("button", { name: /第 1 天/ })).toBeVisible();
});

test("generation failures keep the old preview and retry after cancel", async ({
  page,
}) => {
  const tripId = await createConfirmedTrip(page);
  let calls = 0;
  let releaseFirstRoute: (() => void) | undefined;
  const firstRouteGate = new Promise<void>((resolve) => {
    releaseFirstRoute = resolve;
  });
  await page.route(`**/api/trips/${tripId}/plans/generate`, async (route) => {
    calls += 1;
    if (calls === 1) {
      await firstRouteGate;
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "AI 服务超时，请稍后重试。" }),
    });
  });

  await page.goto(`/trips/${tripId}`);
  const generateButton = page.getByRole("button", { name: "生成基础行程" });
  await generateButton.click();
  const cancelButton = page.getByRole("button", { name: "取消生成" });
  await expect(cancelButton).toBeVisible();
  await expect(page.getByRole("button", { name: /正在生成/ })).toBeDisabled();
  await cancelButton.click();
  releaseFirstRoute?.();
  await expect(page.getByText("已取消本次生成；已有计划保持不变。")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /尚无基础计划/ }),
  ).toBeVisible();

  await generateButton.click();
  await expect(page.getByText("AI 服务超时，请稍后重试。")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /尚无基础计划/ }),
  ).toBeVisible();
  await expect(generateButton).toBeEnabled();
});
