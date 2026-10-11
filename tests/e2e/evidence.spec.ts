import path from "node:path";
import { PrismaClient, type EvidenceFact } from "@prisma/client";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { derivePlanCosts } from "../../lib/budget";
import { effectiveEvidenceStatus, type EvidenceFactClient, type EvidenceField } from "../../lib/evidence";
import { planFixture, requestFixture } from "../helpers/plan-fixtures";

const prisma = new PrismaClient({ datasources: { db: { url: `file:${path.resolve("test-data/e2e/data/serendipity.db").replaceAll("\\", "/")}` } } });
test.afterAll(async () => { await prisma.$disconnect(); });

async function seed(request: APIRequestContext) {
  const response = await request.post("/api/trips", { data: { originalRequest: "Phase10R 受控来源浏览器验收" } });
  expect(response.status()).toBe(201);
  const { trip } = await response.json() as { trip: { id: string } };
  const snapshot = requestFixture();
  const content = planFixture(snapshot);
  const row = await prisma.planVersion.create({ data: {
    tripId: trip.id, versionNumber: 1, requestRevision: 1, requestSnapshot: JSON.stringify(snapshot),
    events: JSON.stringify(content.events), costs: JSON.stringify(derivePlanCosts(content.events)),
    pendingItems: JSON.stringify(content.pendingItems), validationResults: JSON.stringify({ status: "valid", errors: [], warnings: [] }),
  } });
  await prisma.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: row.id, status: "planned" } });
  const fields: EvidenceField[] = ["opening_hours", "reservation", "price", "location"];
  for (const field of fields) await prisma.evidenceFact.create({ data: {
    tripId: trip.id, planVersionId: row.id, targetType: "event", targetId: "d1-activity", field, status: "verified",
    sourceTitle: "Example Museum official visitor information", sourceUrl: "https://www.example.com/visit", sourcePublisher: "www.example.com",
    sourceDateStatus: "applicable", extractedValue: field === "opening_hours" ? "09:00–17:00" : `${field} supported value`,
    contentQuote: "Official source excerpt for this field, with explicit dates.",
    applicableFrom: new Date(`${snapshot.startDate}T00:00:00+08:00`), applicableUntil: new Date(`${snapshot.endDate}T23:59:59+08:00`),
    searchProvider: "duckduckgo", searchQuery: "Example Museum", retrievedAt: new Date(), lastRefreshAt: new Date(), lastRefreshStatus: "success",
  } });
  return { trip, row };
}

function clientFact(row: EvidenceFact): EvidenceFactClient {
  const result = {
    ...row, targetType: "event" as const, field: row.field as EvidenceField, status: row.status as EvidenceFactClient["status"],
    effectiveStatus: "pending" as EvidenceFactClient["effectiveStatus"], sourcePublishedAt: row.sourcePublishedAt?.toISOString() ?? null,
    retrievedAt: row.retrievedAt.toISOString(), applicableFrom: row.applicableFrom?.toISOString() ?? null,
    applicableUntil: row.applicableUntil?.toISOString() ?? null, lastRefreshAt: row.lastRefreshAt?.toISOString() ?? null,
  };
  result.effectiveStatus = effectiveEvidenceStatus(result);
  return result;
}

async function openHours(page: Page) {
  await page.getByRole("button", { name: /Example Museum/ }).first().click();
  await page.getByRole("button", { name: /^开放时间/ }).click();
  return page.getByRole("dialog");
}

test("shows traceable field values, unknown dates and conflicts without claiming the whole card is verified", async ({ page, request }) => {
  const { trip, row } = await seed(request);
  await prisma.evidenceFact.updateMany({ where: { planVersionId: row.id, field: "opening_hours" },
    data: { status: "conflict", conflictReason: "周一闭馆，与当前安排冲突。" } });
  await prisma.evidenceFact.updateMany({ where: { planVersionId: row.id, field: "price" },
    data: { sourceDateStatus: "undated", applicableFrom: null, applicableUntil: null } });
  await page.goto(`/trips/${trip.id}`);
  const card = page.getByRole("button", { name: /Example Museum/ }).first();
  await expect(card).toContainText("来源有冲突");
  await expect(card).not.toContainText("4 项来源字段已核验");
  const drawer = await openHours(page);
  await expect(drawer.getByText("来源冲突", { exact: true })).toBeVisible();
  await expect(drawer.getByText("09:00–17:00", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "打开来源页面" })).toHaveAttribute("href", "https://www.example.com/visit");
  await expect(drawer.getByText("Official source excerpt", { exact: false })).toBeVisible();
  await expect(drawer.getByText("来源未标注内容日期")).toBeVisible();
  await expect(drawer.getByText("来源适用日期")).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: /^价格/ }).click();
  await expect(page.getByRole("dialog").getByText("建议确认", { exact: true })).toBeVisible();
  await expect(page.getByText("未能明确确认适用日期")).toBeVisible();
});

for (const outcome of ["success", "failure"] as const) {
  test(`ignores a late browser ${outcome} after a real note edit creates a new plan`, async ({ page, request }) => {
    const { trip, row } = await seed(request);
    const oldFact = await prisma.evidenceFact.findFirstOrThrow({ where: { planVersionId: row.id, field: "opening_hours" } });
    // Deliver a response even after the client cancels: exercise the scope guard,
    // not only the browser's AbortController implementation. No external request.
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => nativeFetch(input,
        typeof input === "string" && input.endsWith("/evidence") ? { ...init, signal: undefined } : init);
    });
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const beginning = new Promise<void>((resolve) => { started = resolve; });
    await page.route(`**/api/trips/${trip.id}/plans/1/evidence`, async (route) => {
      await prisma.evidenceFact.update({ where: { id: oldFact.id }, data: { lastRefreshStatus: "refreshing", lastRefreshAt: new Date() } });
      started();
      await held;
      await route.fulfill({ status: outcome === "success" ? 200 : 502, contentType: "application/json", body: JSON.stringify(outcome === "success"
        ? { fact: { ...clientFact(oldFact), contentQuote: "LATE OLD SUCCESS" } }
        : { error: "LATE OLD FAILURE" }) });
    });
    try {
      await page.goto(`/trips/${trip.id}`);
      await expect(page.getByRole("button", { name: /Example Museum/ }).first()).toContainText("4 项来源字段已核验");
      const drawer = await openHours(page);
      await drawer.getByLabel("官方域名").fill("example.com");
      await drawer.getByRole("button", { name: "读取并核验" }).click();
      await beginning;
      await expect(drawer.getByText("需复核", { exact: true })).toBeVisible();
      await drawer.getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByLabel("备注", { exact: true }).fill("只改备注，来源需要重新复核。");
      const saveResponse = page.waitForResponse((response) => response.url().endsWith(`/api/trips/${trip.id}/plans/1`) && response.request().method() === "PATCH");
      await page.getByRole("button", { name: "保存修改", exact: true }).click();
      const payload = await (await saveResponse).json();
      expect(payload.plan.evidenceFacts.find((fact: EvidenceFactClient) => fact.field === "opening_hours"))
        .toMatchObject({ lastRefreshStatus: "needs_review", effectiveStatus: "stale" });
      await expect(page.getByRole("heading", { name: /计划版本 2/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Example Museum/ }).first()).toContainText("来源需复核");
      const historyBefore = await prisma.evidenceFact.findUniqueOrThrow({ where: { id: oldFact.id } });
      const pointerBefore = await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });

      const delivered = page.waitForResponse((response) => response.url().endsWith(`/plans/1/evidence`));
      release();
      await (await delivered).finished();
      await page.getByRole("button", { name: /^开放时间/ }).click();
      const currentDrawer = page.getByRole("dialog");
      await expect(currentDrawer.getByText("需复核", { exact: true })).toBeVisible();
      await expect(currentDrawer).not.toContainText("LATE OLD");
      await expect(currentDrawer).toContainText("旧请求的结果不适用于本版本");
      expect(await prisma.evidenceFact.findUnique({ where: { id: oldFact.id } })).toEqual(historyBefore);
      expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).currentPlanVersionId).toBe(pointerBefore.currentPlanVersionId);

      await currentDrawer.getByRole("button", { name: "关闭", exact: true }).click();
      await page.goto(`/trips/${trip.id}?planVersion=1`);
      const historical = await openHours(page);
      await expect(historical).toContainText("这个历史版本保存时来源仍在复核");
      await expect(historical.getByRole("button", { name: "读取并核验" })).toBeDisabled();
    } finally { release(); }
  });
}

test("rejects a response for a different plan or field even in the active drawer", async ({ page, request }) => {
  const { trip, row } = await seed(request);
  const oldFact = await prisma.evidenceFact.findFirstOrThrow({ where: { planVersionId: row.id, field: "opening_hours" } });
  await page.route(`**/api/trips/${trip.id}/plans/1/evidence`, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ fact: { ...clientFact(oldFact), planVersionId: "different-plan", field: "price" } }),
  }));
  await page.goto(`/trips/${trip.id}`);
  const drawer = await openHours(page);
  await drawer.getByLabel("官方域名").fill("example.com");
  await drawer.getByRole("button", { name: "读取并核验" }).click();
  await expect(drawer).toContainText("来源结果属于其他计划或字段");
  await expect(drawer.getByText("需复核", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Example Museum/ }).first()).toContainText("来源需复核");
});
