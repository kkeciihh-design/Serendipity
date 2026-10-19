import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { completeText, testTextConnection, type AIProvider } from "../lib/ai-adapter";
import { parseModelJson } from "../lib/ai-normalizer";

let server: http.Server;
let baseUrl: string;

function extractChallenge(body: string) {
  const match = body.match(/SRD-[a-z0-9]{8}/i);
  return match?.[0] ?? "SRD-unknown";
}

beforeAll(async () => {
  server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.resume();
    request.on("end", () => {
      const challenge = extractChallenge(body);
      const authorization = request.headers.authorization ?? "";
      if (authorization !== "Bearer valid-key" && request.headers["x-api-key"] !== "valid-key") {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid key" } }));
        return;
      }

      if (request.url?.includes("/model-missing")) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "The model test-model was not found" },
          }),
        );
        return;
      }

      const gatewayStatus = request.url?.match(/\/gateway-(408|504)/)?.[1];
      if (gatewayStatus) {
        response.writeHead(Number(gatewayStatus), { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Gateway timeout" } }));
        return;
      }

      if (request.url?.includes("/slow")) {
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              choices: [{ message: { content: "too late" } }],
            }),
          );
        }, 100);
        return;
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.url?.includes("/invalid-json")) {
        response.end("not JSON");
        return;
      }
      const content = request.url?.includes("/fixed-text") ? "Your account has insufficient balance."
        : request.url?.includes("/wrong-challenge") ? `${challenge.slice(0, -1)}${challenge.endsWith("0") ? "1" : "0"}`
          : request.url?.includes("/extra-text") ? `Here is your result: ${challenge}`
            : request.url?.includes("/empty-text") ? ""
              : request.url?.includes("/padded") ? `\n ${challenge} \n` : challenge;
      response.end(JSON.stringify(request.url?.endsWith("/messages")
        ? { content: [{ type: "text", text: content }] }
        : request.url?.endsWith("/responses")
          ? { output: [{ content: [{ type: "output_text", text: content }] }] }
          : { choices: [{ message: { content } }] }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

afterEach(() => vi.restoreAllMocks());

const input = {
  provider: "openai-chat-completions" as const,
  apiKey: "valid-key",
  model: "test-model",
  systemPrompt: "system prompt",
  basePrompt: "base prompt",
};

describe("AI adapter", () => {
  it("rejects a non-loopback HTTP endpoint", async () => {
    const result = await testTextConnection({
      ...input,
      baseUrl: "http://example.com/v1",
    });

    expect(result).toEqual({
      ok: false,
      category: "invalid_url",
      message: "仅允许 HTTPS 地址；本机模型服务可使用回环 HTTP 地址。",
    });
  });

  it("returns a successful text response", async () => {
    const result = await testTextConnection({ ...input, baseUrl });
    if (!result.ok) {
      throw new Error("Expected a successful response.");
    }

    expect(result).toEqual({
      ok: true,
      responsePreview: result.challenge,
      challenge: result.challenge,
    });
  });

  it.each(["openai-chat-completions", "openai-responses", "anthropic-messages"] as const)(
    "requires this request's challenge for %s, allowing surrounding whitespace only",
    async (provider) => {
      const valid = await testTextConnection({ ...input, provider, baseUrl: `${baseUrl}/padded` });
      expect(valid.ok).toBe(true);
      for (const scenario of ["fixed-text", "wrong-challenge", "extra-text", "empty-text", "invalid-json"]) {
        const invalid = await testTextConnection({ ...input, provider, baseUrl: `${baseUrl}/${scenario}` });
        expect(invalid, `${provider}: ${scenario}`).toMatchObject({ ok: false, category: "invalid_response" });
        expect(invalid).not.toHaveProperty("challenge");
      }
    },
  );

  it("classifies an invalid key", async () => {
    const result = await testTextConnection({
      ...input,
      apiKey: "invalid-key",
      baseUrl,
    });

    expect(result).toMatchObject({ ok: false, category: "auth" });
  });

  it("classifies a missing model", async () => {
    const result = await testTextConnection({
      ...input,
      baseUrl: `${baseUrl}/model-missing`,
    });

    expect(result).toMatchObject({ ok: false, category: "model" });
  });

  it("classifies a timeout", async () => {
    const result = await testTextConnection({
      ...input,
      baseUrl: `${baseUrl}/slow`,
      timeoutMs: 10,
    });

    expect(result).toMatchObject({ ok: false, category: "timeout" });
  });

  it("classifies no response", async () => {
    const result = await testTextConnection({
      ...input,
      baseUrl: "http://127.0.0.1:9/v1",
      timeoutMs: 500,
    });

    expect(result).toMatchObject({ ok: false, category: "network" });
  });

  it.each([408, 504])("classifies upstream HTTP %i as a retryable completion timeout", async (status) => {
    const result = await completeText({ ...input, userPrompt: "生成行程", baseUrl: `${baseUrl}/gateway-${status}` });
    expect(result).toMatchObject({ ok: false, category: "timeout" });
  });
});

describe("provider-independent model output handling", () => {
  const answer = { events: [{ title: "五花海 → 珍珠滩瀑布", costCents: "¥190" }] };
  const raw = `<think>先考虑景区路线 {"draft":true}</think>好的，以下是攻略。\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`\n祝旅途愉快。`;
  const payloads: { provider: AIProvider; label: string; payload: unknown }[] = [
    { provider: "openai-chat-completions", label: "DeepSeek reasoning and final content", payload: { choices: [{ message: { reasoning_content: "hidden", content: raw } }] } },
    { provider: "openai-chat-completions", label: "GPT multipart text", payload: { choices: [{ message: { content: [null, { type: "reasoning", text: "must not appear" }, { type: "text", text: raw }] } }] } },
    { provider: "openai-chat-completions", label: "gateway text.value blocks", payload: { choices: [{ message: { content: [{ type: "text", text: { value: raw } }] } }] } },
    { provider: "openai-chat-completions", label: "parsed structured gateway content", payload: { choices: [{ message: { content: null, parsed: answer } }] } },
    { provider: "openai-responses", label: "Responses direct output_text", payload: { output_text: raw } },
    { provider: "openai-responses", label: "Responses reasoning and message output", payload: { output_text: "", output: [{ type: "reasoning", content: [{ type: "text", text: "must not appear" }] }, { type: "message", content: [{ type: "output_text", text: raw }] }] } },
    { provider: "openai-responses", label: "Responses flat text gateway", payload: { output: [{ type: "output_text", text: raw }] } },
    { provider: "anthropic-messages", label: "Claude thinking and text", payload: { content: [{ type: "thinking", thinking: "hidden", text: "must not appear" }, { type: "text", text: raw }] } },
  ];

  it.each(payloads)("extracts and normalizes $label", async ({ provider, payload }) => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await completeText({ ...input, provider, userPrompt: "生成九寨沟行程", baseUrl });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).not.toContain("must not appear");
    expect(parseModelJson(result.content)).toEqual(answer);
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens).toBeGreaterThanOrEqual(8192);
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("text.format");
  });

  it("uses reasoning-model token parameters and retries an explicit incompatible gateway rejection", async () => {
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported parameter max_completion_tokens; use max_tokens" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payloads[0].payload)));
    const result = await completeText({ ...input, model: "gpt-5", userPrompt: "生成行程", baseUrl });
    expect(result.ok).toBe(true);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toHaveProperty("max_completion_tokens", 8192);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toHaveProperty("max_tokens", 8192);
  });

  it("does not misclassify an unrelated model parameter error as a missing model", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "This model requires a different protocol" } }), { status: 400 }));
    expect(await completeText({ ...input, userPrompt: "生成行程", baseUrl })).toMatchObject({ ok: false, category: "service" });
  });

  it.each(["openai-chat-completions", "openai-responses", "anthropic-messages"] as const)("respects an explicit model token upper bound for %s", async (provider) => {
    const key = provider === "openai-responses" ? "max_output_tokens" : "max_tokens";
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: `${key} must be in range [1, 8192]` } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payloads.find((item) => item.provider === provider)!.payload)));
    const result = await completeText({ ...input, provider, maxTokens: 24000, userPrompt: "生成四天行程", baseUrl });
    expect(result.ok).toBe(true);
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toHaveProperty(key, 8192);
  });

  it.each([
    { provider: "openai-chat-completions" as const, payload: { choices: [{ finish_reason: "length", message: { content: '{"events":[' } }] } },
    { provider: "openai-responses" as const, payload: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: '{"events":[' } },
    { provider: "anthropic-messages" as const, payload: { stop_reason: "max_tokens", content: [{ type: "text", text: '{"events":[' }] } },
  ])("reports truncation instead of presenting partial $provider JSON as a plan", async ({ provider, payload }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload)));
    const result = await completeText({ ...input, provider, userPrompt: "生成行程", baseUrl });
    expect(result).toMatchObject({ ok: false, category: "invalid_response", message: expect.stringContaining("截断") });
  });
});
