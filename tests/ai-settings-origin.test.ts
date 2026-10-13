import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedDatabase } from "./helpers/test-database";

let fixture: ReturnType<typeof isolatedDatabase>;
let settings: typeof import("../lib/settings");
const original = {
  provider: "openai-chat-completions" as const,
  baseUrl: "https://original.example/v1",
  model: "test-model",
  apiKey: "synthetic-stored-key",
};
beforeAll(async () => {
  fixture = isolatedDatabase("settings-origin");
  settings = await import("../lib/settings");
  await settings.saveAIConfiguration(original, settings.createTestToken(original));
});
afterAll(async () => {
  await settings?.closeSettingsStore();
  fixture?.cleanup();
});

describe("saved AI keys stay on their configured origin", () => {
  it("allows an empty key when changing only the path on the same origin", async () => {
    const input = { provider: original.provider, baseUrl: "https://ORIGINAL.example:443/v2", model: original.model };
    expect((await settings.effectiveConfiguration(input)).apiKey).toBe(original.apiKey);
    expect((await settings.effectiveModelConfiguration(input)).apiKey).toBe(original.apiKey);
  });

  it.each(["https://different.example/v1", "https://original.example:8443/v1", "http://original.example/v1"])(
    "rejects implicit key reuse for %s before a model-list or connection request",
    async (baseUrl) => {
      const input = { provider: original.provider, baseUrl, model: original.model };
      await expect(settings.effectiveConfiguration(input)).rejects.toThrow("请填写新站点的 API Key");
      await expect(settings.effectiveModelConfiguration(input)).rejects.toThrow("请填写新站点的 API Key");
      expect(await settings.getSafeSettings()).toMatchObject({ ai: { baseUrl: original.baseUrl, keyConfigured: true } });
    },
  );

  it("accepts an explicitly entered key for a different origin without saving it yet", async () => {
    const input = { ...original, baseUrl: "https://different.example/v1", apiKey: "synthetic-new-key" };
    expect((await settings.effectiveConfiguration(input)).apiKey).toBe(input.apiKey);
    expect((await settings.effectiveModelConfiguration(input)).apiKey).toBe(input.apiKey);
    expect((await settings.storedAIConfiguration())?.apiKey).toBe(original.apiKey);
  });
});
