import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";
import { requestFixture } from "./helpers/plan-fixtures";
import { requestDateQuestions } from "../lib/trip-request";
import { completeAutoPlanningRequest } from "../lib/trip-auto-planning";

let database: ReturnType<typeof isolatedDatabase>;
let prisma: PrismaClient;
let trips: typeof import("../lib/trips");
let requests: typeof import("../lib/trip-request-service");
let plans: typeof import("../lib/plan-service");

beforeAll(async () => {
  database = isolatedDatabase("unit-audit-calendar");
  prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  [trips, requests, plans] = await Promise.all([import("../lib/trips"), import("../lib/trip-request-service"), import("../lib/plan-service")]);
});
afterAll(async () => {
  await Promise.all([prisma?.$disconnect(), trips?.closeTripStore(), requests?.closeTripRequestStore(), plans?.closePlanStore()]);
  database?.cleanup();
});

describe("audit calendar write boundaries and history", () => {
  it("persists one-click date assumptions through save and confirmation without weakening revision checks", async () => {
    const original = "去杭州玩三天";
    const trip = await trips.createTrip({ originalRequest: original });
    const snapshot = completeAutoPlanningRequest(original, { ...requestFixture(3), startDate: null, endDate: null });
    const saved = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: snapshot });
    expect(saved.defaultAssumptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "startDate", value: snapshot.startDate }),
      expect.objectContaining({ field: "endDate", value: snapshot.endDate }),
    ]));
    await expect(requests.confirmRequest(trip.id, { expectedRequestRevision: 1 })).rejects.toThrow("需求已经修改");
    const confirmed = await requests.confirmRequest(trip.id, { expectedRequestRevision: saved.requestRevision });
    expect(confirmed.confirmedRequest).toMatchObject({ startDate: snapshot.startDate, endDate: snapshot.endDate });
    expect(confirmed.confirmedRequest?.fieldSources.startDate).toBe("default_assumption");
  });

  it("replaces an AI placeholder assumption with the actual automatic date and keeps it readable", async () => {
    const original = "去杭州玩三天，哪天出发还没定";
    const trip = await trips.createTrip({ originalRequest: original });
    const partial = { ...requestFixture(3), startDate: null, endDate: null };
    const draft = await requests.saveExtractionResult({
      tripId: trip.id, expectedRequestRevision: 1, expectedOriginalRequest: original,
      snapshot: partial, questions: requestDateQuestions(partial),
      assumptions: [{ field: "startDate", value: "待定", reason: "还没确定出发日期。" }],
    });
    const snapshot = completeAutoPlanningRequest(original, draft.extractedRequest!);
    const saved = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: draft.requestRevision, request: snapshot });
    expect(saved.defaultAssumptions?.filter((assumption) => assumption.field === "startDate")).toEqual([
      expect.objectContaining({ field: "startDate", value: snapshot.startDate }),
    ]);
    await requests.confirmRequest(trip.id, { expectedRequestRevision: saved.requestRevision });
    const reloaded = await requests.getTripRequestRecord(trip.id);
    expect(reloaded.confirmedRequest?.fieldSources.startDate).toBe("default_assumption");
    expect(reloaded.defaultAssumptions).toContainEqual(expect.objectContaining({ field: "startDate", value: snapshot.startDate }));
    expect(reloaded.pendingQuestions).toEqual([]);
  });

  it("rejects invalid dates through draft, extraction save and confirmation without changing the stored revision", async () => {
    const original = "日期边界隔离测试";
    const trip = await trips.createTrip({ originalRequest: original });
    const invalid = requestFixture(2, { startDate: "2099-02-29", endDate: "2099-03-01" });
    await expect(requests.saveRequestDraft(trip.id, { expectedRequestRevision: 1, request: invalid })).rejects.toThrow("有效的日历日期");
    await expect(requests.saveExtractionResult({ tripId: trip.id, expectedRequestRevision: 1, expectedOriginalRequest: original,
      snapshot: invalid, questions: [], assumptions: [] })).rejects.toThrow("有效的日历日期");
    expect(await requests.getTripRequestRecord(trip.id)).toMatchObject({ requestRevision: 1, extractedRequest: null });

    // Simulate a previously stored invalid draft: it must remain readable for
    // correction, but it may not be confirmed as a new valid request.
    await prisma.tripRequest.update({ where: { tripId: trip.id }, data: { extractedRequest: JSON.stringify(invalid) } });
    const before = await prisma.tripRequest.findUniqueOrThrow({ where: { tripId: trip.id } });
    expect((await requests.getTripRequestRecord(trip.id)).extractedRequest?.startDate).toBe("2099-02-29");
    await expect(requests.confirmRequest(trip.id, { expectedRequestRevision: 1 })).rejects.toThrow("有效的日历日期");
    expect(await prisma.tripRequest.findUniqueOrThrow({ where: { tripId: trip.id } })).toEqual(before);
  });

  it("saves an unknown return date as a draft with a question, then confirms after the user supplies it", async () => {
    const original = "明天去长沙，还没决定哪天回";
    const trip = await trips.createTrip({ originalRequest: original });
    const complete = requestFixture(2);
    const partial = { ...complete, endDate: null };
    const draft = await requests.saveExtractionResult({ tripId: trip.id, expectedRequestRevision: 1, expectedOriginalRequest: original,
      snapshot: partial, questions: requestDateQuestions(partial), assumptions: [] });
    expect(draft.extractedRequest?.endDate).toBeNull();
    expect(draft.pendingQuestions?.map((question) => question.field)).toEqual(["endDate"]);
    await expect(requests.confirmRequest(trip.id, { expectedRequestRevision: 2 })).rejects.toThrow("具体出发和返回日期");
    const supplied = await requests.saveRequestDraft(trip.id, { expectedRequestRevision: 2, request: complete });
    expect(supplied.pendingQuestions).toEqual([]);
    expect((await requests.confirmRequest(trip.id, { expectedRequestRevision: 3 })).confirmedRequest?.endDate).toBe(complete.endDate);
  });

  it("reads past confirmed snapshots without applying today's write rules", async () => {
    const trip = await trips.createTrip({ originalRequest: "历史旅行读取隔离测试" });
    const history = requestFixture(2, { startDate: "2020-02-28", endDate: "2020-02-29" });
    await prisma.tripRequest.update({ where: { tripId: trip.id }, data: {
      extractedRequest: JSON.stringify(history), confirmedRequest: JSON.stringify(history), confirmedRevision: 1,
    } });
    expect((await requests.getTripRequestRecord(trip.id)).confirmedRequest?.endDate).toBe("2020-02-29");
  });
});
