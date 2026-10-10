"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenCheck,
  ExternalLink,
  Eye,
  EyeOff,
  LogOut,
  PlugZap,
  RotateCcw,
  List,
  Save,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import type { SafeSettings } from "@/lib/settings";
import {
  DEFAULT_BASE_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "@/lib/prompt-defaults";

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

type ConfigurationSnapshot = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
};
type SearchConfigurationSnapshot = {
  provider: string;
  language: string;
};

const readApiError = async (response: Response, fallback: string) => {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? fallback;
};

export function SettingsWorkspace({
  initialSettings,
  csrfToken,
}: {
  initialSettings: SafeSettings;
  csrfToken: string;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [provider, setProvider] = useState(initialSettings.ai.provider);
  const [baseUrl, setBaseUrl] = useState(initialSettings.ai.baseUrl);
  const [model, setModel] = useState(initialSettings.ai.model);
  const [models, setModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFeedback, setModelFeedback] = useState<Feedback | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [basePrompt, setBasePrompt] = useState(
    initialSettings.prompts.basePrompt,
  );
  const [systemPrompt, setSystemPrompt] = useState(
    initialSettings.prompts.systemPrompt,
  );
  const [promptBackup, setPromptBackup] = useState<{
    basePrompt: string;
    systemPrompt: string;
  } | null>(null);
  const [testToken, setTestToken] = useState<string | null>(null);
  const [testedSnapshot, setTestedSnapshot] =
    useState<ConfigurationSnapshot | null>(null);
  const [connectionFeedback, setConnectionFeedback] =
    useState<Feedback | null>(null);
  const [promptFeedback, setPromptFeedback] = useState<Feedback | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [searchLanguage, setSearchLanguage] = useState(
    initialSettings.search.language,
  );
  const [searchTestToken, setSearchTestToken] = useState<string | null>(null);
  const [testedSearchSnapshot, setTestedSearchSnapshot] =
    useState<SearchConfigurationSnapshot | null>(null);
  const [searchFeedback, setSearchFeedback] = useState<Feedback | null>(null);
  const [isTestingSearch, setIsTestingSearch] = useState(false);
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const currentSnapshot: ConfigurationSnapshot = {
    provider,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  };
  const currentSearchSnapshot: SearchConfigurationSnapshot = {
    provider: "duckduckgo",
    language: searchLanguage,
  };

  const providerHelp = provider === "openai-chat-completions"
    ? {
        href: "https://platform.openai.com/docs/api-reference/chat",
        label: "Chat Completions 官方接口说明",
      }
    : provider === "openai-responses"
      ? {
          href: "https://platform.openai.com/docs/api-reference/responses",
          label: "Responses 官方接口说明",
        }
      : {
          href: "https://docs.anthropic.com/en/api/messages",
          label: "Anthropic Messages 官方接口说明",
        };

  const updateProvider = (value: string) => {
    setProvider(value);
    setModels([]);
    setModelFeedback(null);
  };

  const updateBaseUrl = (value: string) => {
    setBaseUrl(value);
    setModels([]);
    setModelFeedback(null);
  };

  const updateApiKey = (value: string) => {
    setApiKey(value);
    setModels([]);
    setModelFeedback(null);
  };

  const fetchModels = async () => {
    if (isFetchingModels || !baseUrl.trim()) {
      return;
    }

    setIsFetchingModels(true);
    setModelFeedback({
      tone: "info",
      message: "正在获取模型列表...",
    });

    try {
      const response = await fetch("/api/settings/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        models?: string[];
        error?: string;
      };

      if (!response.ok || !payload.ok || !Array.isArray(payload.models)) {
        throw new Error(payload.error ?? "获取模型列表失败，请检查配置。");
      }

      setModels(payload.models);
      setModelFeedback({
        tone: "success",
        message: `已获取 ${payload.models.length} 个模型。`,
      });
    } catch (error) {
      setModels([]);
      setModelFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "获取模型列表失败，请检查配置。",
      });
    } finally {
      setIsFetchingModels(false);
    }
  };
  const connectionTested =
    Boolean(testToken) &&
    JSON.stringify(testedSnapshot) === JSON.stringify(currentSnapshot);

  const testConnection = async () => {
    if (isTesting) {
      return;
    }

    setIsTesting(true);
    setConnectionFeedback({
      tone: "info",
      message: "正在连接 AI 服务...",
    });

    try {
      const response = await fetch("/api/settings/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(currentSnapshot),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        testToken?: string;
        responsePreview?: string;
        error?: string;
      };

      if (!response.ok || !payload.ok || !payload.testToken) {
        throw new Error(
          payload.error ?? "连接测试失败，请检查配置。",
        );
      }

      setTestToken(payload.testToken);
      setTestedSnapshot(currentSnapshot);
      setConnectionFeedback({
        tone: "success",
        message: `连接测试通过：${payload.responsePreview ?? "已收到文本响应"}`,
      });
    } catch (error) {
      setTestToken(null);
      setTestedSnapshot(null);
      setConnectionFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "连接测试失败，请检查配置。",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const saveConnection = async () => {
    if (isSavingConnection || !connectionTested || !testToken) {
      return;
    }

    setIsSavingConnection(true);
    setConnectionFeedback({
      tone: "info",
      message: "正在保存 AI 配置...",
    });

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({ ...currentSnapshot, testToken }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "保存 AI 配置失败。"));
      }

      const savedSettings = (await response.json()) as SafeSettings;
      setSettings(savedSettings);
      setProvider(savedSettings.ai.provider);
      setBaseUrl(savedSettings.ai.baseUrl);
      setModel(savedSettings.ai.model);
      setApiKey("");
      setShowApiKey(false);
      setTestToken(null);
      setTestedSnapshot(null);
      setConnectionFeedback({
        tone: "success",
        message: "AI 配置已保存，重启应用后仍可使用。",
      });
      router.refresh();
    } catch (error) {
      setConnectionFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "保存 AI 配置失败，原配置保持不变。",
      });
    } finally {
      setIsSavingConnection(false);
    }
  };

  const testSearchConnection = async () => {
    if (isTestingSearch) {
      return;
    }

    setIsTestingSearch(true);
    setSearchFeedback({
      tone: "info",
      message: "正在连接搜索服务...",
    });
    try {
      const response = await fetch("/api/settings/search/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(currentSearchSnapshot),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        testToken?: string;
        resultCount?: number;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.testToken) {
        throw new Error(payload.error ?? "搜索服务连接失败。");
      }

      setSearchTestToken(payload.testToken);
      setTestedSearchSnapshot(currentSearchSnapshot);
      setSearchFeedback({
        tone: "success",
        message: `搜索服务连接通过，返回 ${payload.resultCount ?? 0} 个结果。`,
      });
    } catch (error) {
      setSearchTestToken(null);
      setTestedSearchSnapshot(null);
      setSearchFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "搜索服务连接失败，原配置保持不变。",
      });
    } finally {
      setIsTestingSearch(false);
    }
  };

  const saveSearchSettings = async () => {
    if (isSavingSearch) {
      return;
    }
    if (
      !searchTestToken ||
      JSON.stringify(testedSearchSnapshot) !==
        JSON.stringify(currentSearchSnapshot)
    ) {
      setSearchFeedback({
        tone: "error",
        message: "请先测试当前搜索配置。",
      });
      return;
    }

    setIsSavingSearch(true);
    setSearchFeedback({
      tone: "info",
      message: "正在保存搜索配置...",
    });
    try {
      const response = await fetch("/api/settings/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          ...currentSearchSnapshot,
          testToken: searchTestToken,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "保存搜索配置失败。"));
      }

      const savedSettings = (await response.json()) as SafeSettings;
      setSettings(savedSettings);
      setSearchLanguage(savedSettings.search.language);
      setSearchTestToken(null);
      setTestedSearchSnapshot(null);
      setSearchFeedback({
        tone: "success",
        message: "搜索配置已保存，来源核验会使用服务端读取。",
      });
      router.refresh();
    } catch (error) {
      setSearchFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "保存搜索配置失败，原配置保持不变。",
      });
    } finally {
      setIsSavingSearch(false);
    }
  };

  const savePrompts = async () => {
    if (isSavingPrompt) {
      return;
    }

    setIsSavingPrompt(true);
    setPromptFeedback({
      tone: "info",
      message: "正在保存 Prompt...",
    });

    try {
      const response = await fetch("/api/settings/prompt", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          basePrompt: basePrompt.trim(),
          systemPrompt: systemPrompt.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, "保存 Prompt 失败。"));
      }

      const savedSettings = (await response.json()) as SafeSettings;
      setSettings(savedSettings);
      setBasePrompt(savedSettings.prompts.basePrompt);
      setSystemPrompt(savedSettings.prompts.systemPrompt);
      setPromptBackup(null);
      setPromptFeedback({
        tone: "success",
        message: "Prompt 已保存，不会改写已有旅行。",
      });
    } catch (error) {
      setPromptFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "保存 Prompt 失败，当前内容保持不变。",
      });
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const logout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await fetch("/api/settings/session", {
        method: "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const promptDirty =
    basePrompt !== settings.prompts.basePrompt ||
    systemPrompt !== settings.prompts.systemPrompt;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-charcoal">AI 基本连接</h2>
          <span
            className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              settings.ai.connectionStatus === "connected"
                ? "bg-sage-soft text-sage"
                : "bg-shell text-graphite"
            }`}
          >
            <ShieldCheck aria-hidden="true" className="size-4" />
            {settings.ai.connectionStatus === "connected"
              ? "已连接"
              : "未配置"}
          </span>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="ai-provider" className="text-base font-semibold text-charcoal">
              上游格式
            </label>
            <select
              id="ai-provider"
              name="ai-provider"
              value={provider}
              onChange={(event) => updateProvider(event.target.value)}
              className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
            >
              <option value="openai-chat-completions">Chat Completions</option>
              <option value="openai-responses">Responses</option>
              <option value="anthropic-messages">Anthropic Messages</option>
            </select>
          </div>
          <div>
            <label htmlFor="ai-model" className="text-base font-semibold text-charcoal">
              模型
            </label>
            <div className="mt-3 flex gap-2">
              <input
                id="ai-model"
                name="ai-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={160}
                required
                className="min-h-12 flex-1 rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
              />
              <button
                type="button"
                onClick={fetchModels}
                disabled={
                  isFetchingModels ||
                  !baseUrl.trim() ||
                  (!apiKey.trim() && !settings.ai.keyConfigured)
                }
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-sage px-4 text-sm font-semibold text-sage transition-colors hover:bg-sage-soft disabled:cursor-not-allowed disabled:border-sand disabled:text-graphite/70"
              >
                <List aria-hidden="true" className="size-5" />
                {isFetchingModels ? "获取中..." : "获取模型"}
              </button>
            </div>
            {models.length > 0 ? (
              <select
                aria-label="选择模型"
                value={models.includes(model) ? model : ""}
                onChange={(event) => setModel(event.target.value)}
                className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
              >
                <option value="">选择模型</option>
                {models.map((modelName) => (
                  <option key={modelName} value={modelName}>
                    {modelName}
                  </option>
                ))}
              </select>
            ) : null}
            {modelFeedback ? (
              <p
                aria-live="polite"
                className={`mt-2 text-sm leading-6 ${
                  modelFeedback.tone === "error"
                    ? "text-clay"
                    : modelFeedback.tone === "success"
                      ? "text-sage"
                      : "text-graphite"
                }`}
              >
                {modelFeedback.message}
              </p>
            ) : null}
            <a
              href={providerHelp.href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-sage hover:text-charcoal"
            >
              {providerHelp.label}
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ai-base-url" className="text-base font-semibold text-charcoal">
              Base URL
            </label>
            <input
              id="ai-base-url"
              name="ai-base-url"
              value={baseUrl}
              onChange={(event) => updateBaseUrl(event.target.value)}
              maxLength={2048}
              required
              className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ai-api-key" className="text-base font-semibold text-charcoal">
              API Key
            </label>
            <div className="mt-3 flex gap-2">
              <input
                id="ai-api-key"
                name="ai-api-key"
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => updateApiKey(event.target.value)}
                maxLength={400}
                autoComplete="new-password"
                className="min-h-12 flex-1 rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((visible) => !visible)}
                aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                className="inline-flex min-h-12 w-12 items-center justify-center rounded-md border border-sand bg-white text-graphite transition-colors hover:border-sage hover:text-sage"
              >
                {showApiKey ? (
                  <EyeOff aria-hidden="true" className="size-5" />
                ) : (
                  <Eye aria-hidden="true" className="size-5" />
                )}
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-graphite">
              {settings.ai.keyConfigured
                ? `${settings.ai.keyMasked}；留空表示继续使用它。`
                : "尚未保存 API Key。"}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={testConnection}
            disabled={isTesting || !baseUrl.trim() || !model.trim()}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-sage px-5 py-3 text-base font-semibold text-sage transition-colors hover:bg-sage-soft disabled:cursor-not-allowed disabled:border-sand disabled:text-graphite/70"
          >
            <PlugZap aria-hidden="true" className="size-5" />
            {isTesting ? "正在测试..." : "测试连接"}
          </button>
          <button
            type="button"
            onClick={saveConnection}
            disabled={isSavingConnection || !connectionTested}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
          >
            <Save aria-hidden="true" className="size-5" />
            {isSavingConnection ? "正在保存..." : "保存配置"}
          </button>
        </div>
        {connectionFeedback ? (
          <p
            aria-live="polite"
            className={`mt-4 rounded-md px-4 py-3 text-base leading-7 ${
              connectionFeedback.tone === "error"
                ? "bg-clay-soft text-clay"
                : connectionFeedback.tone === "success"
                  ? "bg-sage-soft text-sage"
                  : "bg-shell text-graphite"
            }`}
          >
            {connectionFeedback.message}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-charcoal">来源搜索</h2>
          <span
            className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              settings.search.status === "connected"
                ? "bg-sage-soft text-sage"
                : "bg-shell text-graphite"
            }`}
          >
            <BookOpenCheck aria-hidden="true" className="size-4" />
            {settings.search.status === "connected" ? "已连接" : "未测试"}
          </span>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label htmlFor="search-provider" className="block text-base font-semibold text-charcoal">
            提供方
            <select
              id="search-provider"
              value="duckduckgo"
              disabled
              className="mt-3 min-h-12 w-full rounded-md border border-sand bg-graphite/10 px-4 py-3 text-base leading-7 text-graphite"
            >
              <option value="duckduckgo">DuckDuckGo</option>
            </select>
          </label>
          <label htmlFor="search-language" className="block text-base font-semibold text-charcoal">
            搜索语言
            <select
              id="search-language"
              value={searchLanguage}
              onChange={(event) => {
                setSearchLanguage(
                  event.target.value === "zh-CN" ? "zh-CN" : "en",
                );
                setSearchTestToken(null);
                setTestedSearchSnapshot(null);
              }}
              className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
            >
              <option value="en">English</option>
              <option value="zh-CN">中文</option>
            </select>
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={testSearchConnection}
            disabled={isTestingSearch}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-sage px-5 py-3 text-base font-semibold text-sage transition-colors hover:bg-sage-soft disabled:cursor-not-allowed disabled:border-sand disabled:text-graphite/70"
          >
            <PlugZap aria-hidden="true" className="size-5" />
            {isTestingSearch ? "正在测试..." : "测试搜索"}
          </button>
          <button
            type="button"
            onClick={saveSearchSettings}
            disabled={
              isSavingSearch ||
              !searchTestToken ||
              JSON.stringify(testedSearchSnapshot) !==
                JSON.stringify(currentSearchSnapshot)
            }
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
          >
            <Save aria-hidden="true" className="size-5" />
            {isSavingSearch ? "正在保存..." : "保存搜索配置"}
          </button>
        </div>
        {searchFeedback ? (
          <p
            aria-live="polite"
            className={`mt-4 rounded-md px-4 py-3 text-base leading-7 ${
              searchFeedback.tone === "error"
                ? "bg-clay-soft text-clay"
                : searchFeedback.tone === "success"
                  ? "bg-sage-soft text-sage"
                  : "bg-shell text-graphite"
            }`}
          >
            {searchFeedback.message}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-charcoal">Prompt 高级选项</h2>
          <span className="inline-flex min-h-11 items-center rounded-md bg-shell px-3 py-2 text-sm font-medium text-graphite">
            版本 {settings.prompts.version}
          </span>
        </div>
        <div className="mt-5 space-y-5">
          <div>
            <label htmlFor="base-prompt" className="text-base font-semibold text-charcoal">
              基础 Prompt
            </label>
            <textarea
              id="base-prompt"
              name="base-prompt"
              value={basePrompt}
              onChange={(event) => setBasePrompt(event.target.value)}
              rows={4}
              maxLength={6000}
              className="mt-3 min-h-32 w-full resize-y rounded-md border border-sand bg-cream px-4 py-3 text-base leading-8 text-charcoal focus:border-sage focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="system-prompt" className="text-base font-semibold text-charcoal">
              系统 Prompt
            </label>
            <textarea
              id="system-prompt"
              name="system-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              rows={6}
              maxLength={6000}
              className="mt-3 min-h-40 w-full resize-y rounded-md border border-sand bg-cream px-4 py-3 text-base leading-8 text-charcoal focus:border-sage focus:outline-none"
            />
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={savePrompts}
            disabled={isSavingPrompt || !promptDirty}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
          >
            <Save aria-hidden="true" className="size-5" />
            {isSavingPrompt ? "正在保存..." : "保存 Prompt"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPromptBackup({ basePrompt, systemPrompt });
              setBasePrompt(DEFAULT_BASE_PROMPT);
              setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
            }}
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-sand px-5 py-3 text-base font-medium text-graphite transition-colors hover:border-sage hover:text-sage"
          >
            <RotateCcw aria-hidden="true" className="size-5" />
            恢复默认
          </button>
          {promptBackup ? (
            <button
              type="button"
              onClick={() => {
                setBasePrompt(promptBackup.basePrompt);
                setSystemPrompt(promptBackup.systemPrompt);
                setPromptBackup(null);
              }}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-sand px-5 py-3 text-base font-medium text-graphite transition-colors hover:border-sage hover:text-sage"
            >
              <Undo2 aria-hidden="true" className="size-5" />
              撤销恢复
            </button>
          ) : null}
        </div>
        {promptFeedback ? (
          <p
            aria-live="polite"
            className={`mt-4 rounded-md px-4 py-3 text-base leading-7 ${
              promptFeedback.tone === "error"
                ? "bg-clay-soft text-clay"
                : promptFeedback.tone === "success"
                  ? "bg-sage-soft text-sage"
                  : "bg-shell text-graphite"
            }`}
          >
            {promptFeedback.message}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-sand/80 bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-xl font-semibold text-charcoal">会话</h2>
          <p className="mt-2 text-sm leading-6 text-graphite">
            个人密码用于保护 AI 设置；本机访问旅行功能保持可用。
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={isLoggingOut}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-clay px-5 py-3 text-base font-semibold text-clay transition-colors hover:bg-clay-soft disabled:cursor-not-allowed disabled:opacity-70"
        >
          <LogOut aria-hidden="true" className="size-5" />
          {isLoggingOut ? "正在退出..." : "退出设置"}
        </button>
      </section>
    </div>
  );
}
