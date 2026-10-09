import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testTextConnection } from "../lib/ai-adapter";

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
      if (authorization !== "Bearer valid-key") {
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
      response.end(
        JSON.stringify({
          choices: [{ message: { content: challenge } }],
        }),
      );
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
});
