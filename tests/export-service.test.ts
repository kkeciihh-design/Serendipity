import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { isolatedDatabase } from "./helpers/test-database";
import { exportFixture } from "./helpers/export-fixtures";
let database: ReturnType<typeof isolatedDatabase>, db: PrismaClient, service: typeof import("../lib/export-service");
beforeAll(async () => { database = isolatedDatabase("unit-mobile-export"); db = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } }); service = await import("../lib/export-service"); });
afterAll(async () => { await service?.closeExportStore(); await db?.$disconnect(); database?.cleanup(); });
async function seed() {
  const s = await exportFixture(), trip = await db.trip.create({ data: { title: "合成导出", originalRequest: "test" } });
  const p = s.plan;
  const plan = await db.planVersion.create({ data: { tripId: trip.id, versionNumber: 1, requestRevision: 2, requestSnapshot: JSON.stringify(p.requestSnapshot), events: JSON.stringify(p.events), costs: JSON.stringify(p.costs), tickets: JSON.stringify(p.tickets), pendingItems: JSON.stringify(p.pendingItems), validationResults: JSON.stringify(p.validationResults) } });
  await db.trip.update({ where: { id: trip.id }, data: { currentPlanVersionId: plan.id } });
  await db.tripRequest.create({ data: { tripId: trip.id, originalRequest: "changed", requestRevision: 3, confirmedRevision: 3, confirmedRequest: JSON.stringify({ ...p.requestSnapshot, startDate: "2040-01-01", endDate: "2040-01-04", travelerCount: 20, budgetAmountCents: 1 }) } });
  await db.executionState.create({ data: { tripId: trip.id, revision: 4, planVersion: 1, payload: JSON.stringify({ startedAt: s.generatedAt, endedAt: null, currentEventId: "d1-lunch", location: null, items: [{ eventId: "d1-activity", title: "博物馆", locationName: "博物馆", arrivedAt: s.generatedAt, completedAt: s.generatedAt }] }) } });
  return trip.id;
}
describe("durable coherent export records", () => {
  it("text formats reuse snapshots, retain exact bytes, isolate history and reject unsupported formats", async () => {
    const id = await seed();
    const html = await service.createMobileExport(id, { expectedPlanVersion: 1, options: {} });
    for (const format of ["plain-text", "markdown"] as const) {
      const file = await service.createExport(id, { expectedPlanVersion: 1, format, options: {} });
      expect(file.format).toBe(format); expect(file.filename.endsWith(format === "markdown" ? ".md" : ".txt")).toBe(true);
      const original = await service.getExportFile(id, file.id);
      expect(original.html).toContain("计划待更新"); expect(original.html).toContain("4 人"); expect(original.html).toContain("已手动完成"); expect(original.html).not.toContain("2040");
      const stored = await db.exportFile.findUniqueOrThrow({ where: { id: file.id } });
      const snapshot = JSON.parse(stored.snapshot);
      const { renderTextExport } = await import("../lib/text-export");
      expect(renderTextExport(snapshot, file.options, format)).toBe(original.html);
      expect(file.sha256).toBe(createHash("sha256").update(original.html, "utf8").digest("hex"));
      await service.closeExportStore(); expect(await service.getExportFile(id, file.id)).toEqual(original);
    }
    expect((await service.getExportPanel(id)).files.map((f) => f.id)).toEqual([html.id]);
    expect((await service.getExportPanel(id, "text")).files).toHaveLength(2);
    await expect(service.createExport(id, { expectedPlanVersion: 1, format: "pdf", options: {} })).rejects.toThrow();
    await expect(service.createExport(id, { expectedPlanVersion: 99, format: "plain-text", options: {} })).rejects.toThrow("计划已更新");
    await expect(service.createExport(id, { expectedPlanVersion: 1, format: "markdown", options: {} }, AbortSignal.abort())).rejects.toThrow("取消");
    expect(await db.exportFile.count({ where: { tripId: id } })).toBe(3);
  });
  it("T29 captures old R/date/travellers/budget with preparation and execution, persists exact bytes on reconnect", async () => {
    const id = await seed(), file = await service.createMobileExport(id, { expectedPlanVersion: 1, options: {} });
    expect(file).toMatchObject({ planVersion: 1, requestRevision: 2, executionRevision: 4, requirementUpToDate: false });
    const original = await service.getExportFile(id, file.id);
    expect(original.html).toContain("4 人"); expect(original.html).toContain("1500 元"); expect(original.html).toContain("已手动完成"); expect(original.html).not.toContain("2040-01-01");
    expect(original.sha256).toBe(createHash("sha256").update(original.html).digest("hex"));
    await db.executionState.update({ where: { tripId: id }, data: { revision: 5 } });
    await service.closeExportStore(); expect(await service.getExportFile(id, file.id)).toEqual(original);
    const stored = JSON.parse((await db.exportFile.findUniqueOrThrow({ where: { id: file.id } })).snapshot);
    expect(stored.execution.revision).toBe(4); expect(stored.plan.requestSnapshot.travelerCount).toBe(4); expect(stored.checklist.items.length).toBeGreaterThan(0);
    expect((await service.getExportPanel(id)).files[0].id).toBe(file.id);
  });
  it("rejects stale plan, outside date and cancelled generation without partial file rows", async () => {
    const id = await seed();
    await expect(service.createMobileExport(id, { expectedPlanVersion: 2, options: {} })).rejects.toThrow("计划已更新");
    await expect(service.createMobileExport(id, { expectedPlanVersion: 1, options: { dates: ["1999-01-01"] } })).rejects.toThrow("日期");
    await expect(service.createMobileExport(id, { expectedPlanVersion: 1, options: {} }, AbortSignal.abort())).rejects.toThrow("取消");
    expect(await db.exportFile.count({ where: { tripId: id } })).toBe(0);
  });
  it("file lookup is scoped to its trip; deletion only cascades application records", async () => {
    const id = await seed(), other = await seed(), file = await service.createMobileExport(id, { expectedPlanVersion: 1, options: {} });
    await expect(service.getExportFile(other, file.id)).rejects.toThrow("不存在");
    await db.trip.update({ where: { id }, data: { currentPlanVersionId: null } }); await db.trip.delete({ where: { id } });
    await expect(service.getExportFile(id, file.id)).rejects.toThrow("不存在");
    expect(await db.trip.count({ where: { id: other } })).toBe(1);
  });
});
