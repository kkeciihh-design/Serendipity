import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";
let database: ReturnType<typeof isolatedDatabase>;
beforeAll(() => { database = isolatedDatabase("unit-extraction-generation"); });
afterAll(() => database?.cleanup());
import { emptyRequestSnapshot } from "../lib/trip-request";

const mocked = vi.hoisted(() => ({ completeText: vi.fn(), getRecord: vi.fn(), save: vi.fn() }));
vi.mock("../lib/ai-adapter", () => ({ completeText: mocked.completeText }));
vi.mock("../lib/settings", () => ({ storedAIConfiguration: async () => ({
  provider: "openai_compatible", baseUrl: "https://example.invalid/v1", apiKey: "in-memory-test", model: "test", systemPrompt: "",
}) }));
vi.mock("../lib/trip-request-service", () => ({
  getTripRequestRecord: mocked.getRecord, saveExtractionResult: mocked.save,
  TripRequestValidationError: class extends Error {},
}));
import { extractTripRequest } from "../lib/requirement-extraction";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T16:30:00Z")); // 2026-10-30, China time.
  vi.clearAllMocks();
  mocked.completeText.mockResolvedValue({ ok: true, content: JSON.stringify({
    request: { ...emptyRequestSnapshot(), destination: "长沙" }, openQuestions: [], defaultAssumptions: [],
  }) });
  mocked.save.mockImplementation(async (input) => input);
});
afterEach(() => vi.useRealTimers());

describe("audit requirement extraction dates", () => {
  it("persists four stated days using the China clock through the real extraction flow", async () => {
    mocked.getRecord.mockResolvedValue({ requestRevision: 1, originalRequest: "明天去长沙四天" });
    await extractTripRequest("trip", 1);
    expect(mocked.save).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({ startDate: "2026-10-31", endDate: "2026-11-03" }), questions: [],
    }));
    expect(mocked.completeText.mock.calls[0][0].userPrompt).toContain("2026-10-30（北京时间）");
  });

  it("saves an unknown return date and supplies the missing question when AI omitted it", async () => {
    mocked.getRecord.mockResolvedValue({ requestRevision: 1, originalRequest: "明天去长沙" });
    await extractTripRequest("trip", 1);
    expect(mocked.save).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({ startDate: "2026-10-31", endDate: null }),
      questions: [expect.objectContaining({ field: "endDate", question: "计划旅行几天，或哪天返回？" })],
    }));
  });

  it("does not save an impossible calendar date even when the model repeats it during repair", async () => {
    mocked.getRecord.mockResolvedValue({ requestRevision: 1, originalRequest: "来年春天去长沙" });
    mocked.completeText.mockResolvedValue({ ok: true, content: JSON.stringify({
      request: { ...emptyRequestSnapshot(), destination: "长沙", startDate: "2027-02-29", endDate: "2027-03-01" },
    }) });
    await expect(extractTripRequest("trip", 1)).rejects.toMatchObject({ category: "invalid_output" });
    expect(mocked.completeText).toHaveBeenCalledTimes(2);
    expect(mocked.save).not.toHaveBeenCalled();
  });
});
