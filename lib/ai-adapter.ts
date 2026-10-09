import { isLoopbackHost } from "./request-security";
import { randomUUID } from "node:crypto";

export type AIConnectionTestResult =
  | {
      ok: true;
      responsePreview: string;
      challenge: string;
    }
  | {
      ok: false;
      category:
        | "invalid_url"
        | "auth"
        | "model"
        | "rate_limit"
        | "timeout"
        | "network"
        | "service"
        | "invalid_response";
      message: string;
    };

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type AIModelListResult =
  | { ok: true; models: string[] }
  | { ok: false; message: string };

export type AIProvider =
  | "openai-chat-completions"
  | "openai-responses"
  | "anthropic-messages";

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

function endpointUrl(baseUrl: string, provider: AIProvider) {
  const normalized = normalizeBaseUrl(baseUrl);
  switch (provider) {
    case "openai-chat-completions":
      return normalized.endsWith("/chat/completions")
        ? normalized
        : `${normalized}/chat/completions`;
    case "openai-responses":
      return normalized.endsWith("/responses")
        ? normalized
        : `${normalized}/responses`;
    case "anthropic-messages":
      return normalized.endsWith("/messages")
        ? normalized
        : `${normalized}/messages`;
  }
}

function modelsUrl(baseUrl: string) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

function providerHeaders(
  provider: AIProvider,
  apiKey: string,
): Record<string, string> {
  if (provider === "anthropic-messages") {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function createConnectionChallenge() {
  return `SRD-${randomUUID().slice(0, 8)}`;
}

function parseModels(payload: unknown) {
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => (item as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

function textFromResponse(payload: unknown, provider: AIProvider) {
  if (provider === "openai-chat-completions") {
    const choices = (payload as { choices?: unknown }).choices;
    const message = Array.isArray(choices)
      ? (choices[0] as { message?: { content?: unknown } })?.message
      : undefined;
    if (typeof message?.content === "string") {
      return message.content;
    }
    if (Array.isArray(message?.content)) {
      return message.content
        .map((part) => (part as { text?: unknown }).text)
        .filter((text): text is string => typeof text === "string")
        .join("");
    }
    return "";
  }

  if (provider === "openai-responses") {
    const direct = (payload as { output_text?: unknown }).output_text;
    if (typeof direct === "string") {
      return direct;
    }

    const output = (payload as { output?: unknown }).output;
    if (!Array.isArray(output)) {
      return "";
    }

    return output
      .flatMap((item) => {
        const content = (item as { content?: unknown }).content;
        return Array.isArray(content) ? content : [];
      })
      .map((part) => (part as { text?: unknown }).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
  }

  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

function requestUrl(baseUrl: string, provider: AIProvider) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return endpointUrl(trimmed, provider);
}

function limitText(text: string, maxLength: number) {
  const characters = Array.from(text);
  return characters.length <= maxLength
    ? text
    : `${characters.slice(0, maxLength).join("")}...`;
}

async function readResponseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("response too large");
  }

  if (!response.body) {
    return await response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function testTextConnection(input: {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  basePrompt: string;
  timeoutMs?: number;
}): Promise<AIConnectionTestResult> {
  let url: URL;
  const challenge = createConnectionChallenge();
  try {
    url = new URL(requestUrl(input.baseUrl, input.provider));
  } catch {
    return {
      ok: false,
      category: "invalid_url",
      message: "Base URL 不正确，请填写服务接口地址。",
    };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (url.protocol === "http:" && !isLoopbackHost(url.host))
  ) {
    return {
      ok: false,
      category: "invalid_url",
      message:
        "仅允许 HTTPS 地址；本机模型服务可使用回环 HTTP 地址。",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: providerHeaders(input.provider, input.apiKey),
      body: JSON.stringify(
        input.provider === "openai-chat-completions"
          ? {
              model: input.model,
              messages: [
                { role: "system", content: input.systemPrompt },
                {
                  role: "user",
                  content: `${input.basePrompt}\n请只回复：${challenge}`,
                },
              ],
              temperature: 0,
              max_tokens: 32,
            }
          : input.provider === "openai-responses"
            ? {
                model: input.model,
                instructions: input.systemPrompt,
                input: `${input.basePrompt}\n请只回复：${challenge}`,
                max_output_tokens: 32,
                temperature: 0,
              }
            : {
                model: input.model,
                system: input.systemPrompt,
                max_tokens: 32,
                messages: [
                  {
                    role: "user",
                    content: `${input.basePrompt}\n请只回复：${challenge}`,
                  },
                ],
              },
      ),
      signal: AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });

    let responseText;
    try {
      responseText = await readResponseText(response);
    } catch (error) {
      if (error instanceof Error && error.message === "response too large") {
        return {
          ok: false,
          category: "service",
          message: "服务响应过大，已终止本次测试。",
        };
      }
      throw error;
    }

    if (responseText.length > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        category: "service",
        message: "服务响应过大，已终止本次测试。",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        category: "auth",
        message: "服务拒绝了这个 API Key，请核对密钥权限。",
      };
    }

    if (response.status === 429) {
      return {
        ok: false,
        category: "rate_limit",
        message: "服务限流，请稍后再试。",
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }

    const serviceErrorMessage =
      typeof payload === "object" && payload !== null
        ? String(
            (
              payload as {
                error?: { message?: unknown };
                message?: unknown;
              }
            ).error?.message ??
              (payload as { message?: unknown }).message ??
            "",
          )
        : "";

    if (
      response.status === 404 ||
      ((response.status === 400 || response.status === 404) &&
        /model/i.test(serviceErrorMessage))
    ) {
      return {
        ok: false,
        category: "model",
        message: "服务没有找到这个模型，请核对模型名称。",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        category: "service",
        message: `服务返回 HTTP ${response.status}，请稍后再试。`,
      };
    }

    if (payload === null) {
      return {
        ok: false,
        category: "invalid_response",
        message: "服务没有返回可识别的 JSON 响应。",
      };
    }

    const content = textFromResponse(payload, input.provider);
    if (typeof content !== "string" || content.trim().length === 0) {
      return {
        ok: false,
        category: "invalid_response",
        message: "服务响应中没有文本结果。",
      };
    }

    return {
      ok: true,
      responsePreview: limitText(content.trim(), 120),
      challenge,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        category: "timeout",
        message: "连接超时，请确认服务地址和网络状态。",
      };
    }

    return {
      ok: false,
      category: "network",
      message: "无法连接到服务，请确认地址或服务是否已启动。",
    };
  }
}

export type AICompletionResult =
  | { ok: true; content: string }
  | {
      ok: false;
      category:
        | "invalid_url"
        | "aborted"
        | "auth"
        | "model"
        | "rate_limit"
        | "timeout"
        | "network"
        | "service"
        | "invalid_response";
      message: string;
    };

export async function completeText(input: {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<AICompletionResult> {
  let url: URL;
  try {
    url = new URL(requestUrl(input.baseUrl, input.provider));
  } catch {
    return {
      ok: false,
      category: "invalid_url",
      message: "AI 服务地址不正确，请在设置页核对 Base URL。",
    };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (url.protocol === "http:" && !isLoopbackHost(url.host))
  ) {
    return {
      ok: false,
      category: "invalid_url",
      message: "仅允许 HTTPS AI 服务；本机模型服务可使用回环 HTTP 地址。",
    };
  }

  const maxTokens = input.maxTokens ?? 1600;
  const timeoutSignal = AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: providerHeaders(input.provider, input.apiKey),
      body: JSON.stringify(
        input.provider === "openai-chat-completions"
          ? {
              model: input.model,
              messages: [
                { role: "system", content: input.systemPrompt },
                { role: "user", content: input.userPrompt },
              ],
              temperature: 0,
              max_tokens: maxTokens,
            }
          : input.provider === "openai-responses"
            ? {
                model: input.model,
                instructions: input.systemPrompt,
                input: input.userPrompt,
                max_output_tokens: maxTokens,
                temperature: 0,
              }
            : {
                model: input.model,
                system: input.systemPrompt,
                max_tokens: maxTokens,
                messages: [{ role: "user", content: input.userPrompt }],
              },
      ),
      signal: input.signal
        ? AbortSignal.any([timeoutSignal, input.signal])
        : timeoutSignal,
      cache: "no-store",
      redirect: "error",
    });

    const responseText = await readResponseText(response);
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        category: "auth",
        message: "AI 服务拒绝了这个 API Key，请在设置页核对密钥权限。",
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        category: "rate_limit",
        message: "AI 服务限流，请稍后再试。",
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
    const serviceErrorMessage =
      typeof payload === "object" && payload !== null
        ? String(
            (
              payload as {
                error?: { message?: unknown };
                message?: unknown;
              }
            ).error?.message ??
              (payload as { message?: unknown }).message ??
              "",
          )
        : "";
    if (
      response.status === 404 ||
      ((response.status === 400 || response.status === 404) &&
        /model/i.test(serviceErrorMessage))
    ) {
      return {
        ok: false,
        category: "model",
        message: "AI 服务没有找到这个模型，请在设置页核对模型名称。",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        category: "service",
        message: `AI 服务返回 HTTP ${response.status}，请稍后再试。`,
      };
    }
    if (payload === null) {
      return {
        ok: false,
        category: "invalid_response",
        message: "AI 服务没有返回可识别的 JSON 响应。",
      };
    }

    const content = textFromResponse(payload, input.provider);
    if (!content.trim()) {
      return {
        ok: false,
        category: "invalid_response",
        message: "AI 服务响应中没有文本结果。",
      };
    }

    return { ok: true, content };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError") &&
      input.signal?.aborted
    ) {
      return {
        ok: false,
        category: "aborted",
        message: "本次 AI 请求已取消，结果不会保存。",
      };
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        category: "timeout",
        message: "AI 请求超时，请确认服务状态后重试。",
      };
    }
    return {
      ok: false,
      category: "network",
      message: "无法连接到 AI 服务，请确认设置或网络状态。",
    };
  }
}

export async function fetchModelList(input: {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): Promise<AIModelListResult> {
  let url: URL;
  try {
    url = new URL(modelsUrl(input.baseUrl));
  } catch {
    return {
      ok: false,
      message: "Base URL 不正确，请填写服务接口地址。",
    };
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (url.protocol === "http:" && !isLoopbackHost(url.host))
  ) {
    return {
      ok: false,
      message: "仅允许 HTTPS 地址；本机模型服务可使用回环 HTTP 地址。",
    };
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: providerHeaders(input.provider, input.apiKey),
      signal: AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });

    const responseText = await readResponseText(response);
    if (responseText.length > MAX_RESPONSE_BYTES) {
      return {
        ok: false,
        message: "模型列表响应过大，已终止本次请求。",
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: "服务拒绝了这个 API Key，请核对密钥权限。",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        message: `获取模型列表失败（HTTP ${response.status}）。`,
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return {
        ok: false,
        message: "服务没有返回可识别的模型列表。",
      };
    }

    const models = parseModels(payload);
    if (models.length === 0) {
      return {
        ok: false,
        message: "服务没有返回可用模型。",
      };
    }

    return {
      ok: true,
      models,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        message: "获取模型列表超时，请确认服务地址和网络状态。",
      };
    }

    return {
      ok: false,
      message: "无法连接到服务，请确认地址或服务是否已启动。",
    };
  }
}
