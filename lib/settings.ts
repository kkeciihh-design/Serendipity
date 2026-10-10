import crypto from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { z, type ZodType } from "zod";
import {
  createSignedPayload,
  decryptSecret,
  encryptSecret,
  hashPassword,
  verifyPassword,
  verifySignedPayload,
} from "./security";
import { getDatabaseUrl } from "./data-directory";
import {
  DEFAULT_BASE_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
} from "./prompt-defaults";

const SINGLETON_ID = "singleton";
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const API_KEY_MAX_LENGTH = 400;
const PROMPT_MAX_LENGTH = 6000;
const TEST_TOKEN_TTL_MS = 30 * 60 * 1000;

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, "个人密码至少 8 位。")
      .max(PASSWORD_MAX_LENGTH, "个人密码最多 128 位。"),
    confirmation: z.string(),
  })
  .refine((input) => input.password === input.confirmation, {
    message: "两次输入的个人密码不一致。",
  });

const AI_PROVIDERS = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
] as const;

export type AIProvider = (typeof AI_PROVIDERS)[number];

const SEARCH_PROVIDERS = ["duckduckgo"] as const;
const SEARCH_LANGUAGES = ["en", "zh-CN"] as const;

const aiBaseConfigurationSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  baseUrl: z
    .string()
    .trim()
    .min(1, "Base URL 不能为空。")
    .max(2048, "Base URL 过长。"),
  apiKey: z
    .string()
    .trim()
    .max(API_KEY_MAX_LENGTH, "API Key 过长。")
    .optional(),
});

const aiConfigurationSchema = aiBaseConfigurationSchema.extend({
  model: z
    .string()
    .trim()
    .min(1, "模型名称不能为空。")
    .max(160, "模型名称最多 160 字。"),
});

const promptSchema = z.object({
  basePrompt: z
    .string()
    .trim()
    .min(1, "基础 Prompt 不能为空。")
    .max(PROMPT_MAX_LENGTH, `基础 Prompt 最多 ${PROMPT_MAX_LENGTH} 字。`),
  systemPrompt: z
    .string()
    .trim()
    .min(1, "系统 Prompt 不能为空。")
    .max(PROMPT_MAX_LENGTH, `系统 Prompt 最多 ${PROMPT_MAX_LENGTH} 字。`),
});

export type AIConfigurationInput = z.infer<typeof aiConfigurationSchema>;
export type AIModelConfigurationInput = z.infer<typeof aiBaseConfigurationSchema>;
export type PromptInput = z.infer<typeof promptSchema>;
const searchConfigurationSchema = z.object({
  provider: z.enum(SEARCH_PROVIDERS),
  language: z.enum(SEARCH_LANGUAGES),
});
export type SearchConfigurationInput = z.infer<typeof searchConfigurationSchema>;
export type SafeSettings = {
  passwordConfigured: boolean;
  ai: {
    provider: string;
    baseUrl: string;
    model: string;
    keyConfigured: boolean;
    keyMasked: string | null;
    connectionStatus: string;
    connectionCheckedAt: string | null;
    connectionError: string | null;
  };
  prompts: {
    version: number;
    basePrompt: string;
    systemPrompt: string;
  };
  search: {
    provider: "duckduckgo";
    language: "en" | "zh-CN";
    status: string;
    checkedAt: string | null;
    error: string | null;
  };
};

type PrismaStore = {
  appSettings: {
    findUnique: PrismaClient["appSettings"]["findUnique"];
    create: PrismaClient["appSettings"]["create"];
    update: PrismaClient["appSettings"]["update"];
  };
};

type PrismaGlobal = typeof globalThis & {
  serendipitySettingsPrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;
const prisma =
  prismaGlobal.serendipitySettingsPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.serendipitySettingsPrisma = prisma;
}

const store: PrismaStore = prisma;

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

export class SettingsNotFoundError extends Error {
  constructor() {
    super("设置尚未初始化。");
    this.name = "SettingsNotFoundError";
  }
}

function parseOrThrow<T>(schema: ZodType<T>, input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new SettingsValidationError(
      result.error.issues[0]?.message ?? "设置输入不合法。",
    );
  }
  return result.data;
}

async function ensureSettingsRecord() {
  const existing = await store.appSettings.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (existing) {
    return existing;
  }

  try {
    return await store.appSettings.create({
      data: {
        id: SINGLETON_ID,
        basePrompt: DEFAULT_BASE_PROMPT,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return store.appSettings.findUnique({
        where: { id: SINGLETON_ID },
      });
    }
    throw error;
  }
}

export async function getSettingsRecord() {
  const record = await ensureSettingsRecord();
  if (!record) {
    throw new SettingsNotFoundError();
  }
  return record;
}

export async function isPasswordConfigured() {
  const record = await ensureSettingsRecord();
  return Boolean(record?.passwordHash && record.passwordSalt);
}

export async function setInitialPassword(input: unknown) {
  const parsed = parseOrThrow(passwordSchema, input);
  const record = await ensureSettingsRecord();
  if (record?.passwordHash || record?.passwordSalt) {
    throw new SettingsValidationError("个人密码已经设置。");
  }

  const { hash, salt } = hashPassword(parsed.password);
  await store.appSettings.update({
    where: { id: SINGLETON_ID },
    data: {
      passwordHash: hash,
      passwordSalt: salt,
    },
  });
}

export async function checkPassword(input: unknown) {
  const parsed = parseOrThrow(
    z.object({ password: z.string().min(1, "请输入个人密码。") }),
    input,
  );
  const record = await ensureSettingsRecord();
  if (!record?.passwordHash || !record.passwordSalt) {
    throw new SettingsValidationError("请先设置个人密码。");
  }

  return verifyPassword(
    parsed.password,
    record.passwordSalt,
    record.passwordHash,
  );
}

export async function getSafeSettings(): Promise<SafeSettings> {
  const record = await getSettingsRecord();
  const provider =
    record.provider === "openai-responses" ||
    record.provider === "anthropic-messages"
      ? record.provider
      : "openai-chat-completions";

  return {
    passwordConfigured: Boolean(record.passwordHash && record.passwordSalt),
    ai: {
      provider,
      baseUrl: record.baseUrl ?? "",
      model: record.model ?? "",
      keyConfigured: Boolean(record.apiKeyCiphertext),
      keyMasked: record.apiKeyLast4
        ? `已配置，末尾 ${record.apiKeyLast4}`
        : null,
      connectionStatus: record.connectionStatus,
      connectionCheckedAt: record.connectionCheckedAt?.toISOString() ?? null,
      connectionError: record.connectionError,
    },
    prompts: {
      version: record.promptVersion,
      basePrompt: record.basePrompt,
      systemPrompt: record.systemPrompt,
    },
    search: {
      provider:
        record.searchProvider === "duckduckgo" ? "duckduckgo" : "duckduckgo",
      language: record.searchLanguage === "zh-CN" ? "zh-CN" : "en",
      status: record.searchStatus ?? "not_tested",
      checkedAt: record.searchCheckedAt?.toISOString() ?? null,
      error: record.searchError,
    },
  };
}

export async function effectiveModelConfiguration(input: unknown) {
  const parsed = parseOrThrow(aiBaseConfigurationSchema, input);
  const record = await getSettingsRecord();
  const apiKey = parsed.apiKey?.trim() || (await existingApiKey(record));
  if (!apiKey) {
    throw new SettingsValidationError("API Key 不能为空。");
  }

  return {
    provider: parsed.provider,
    baseUrl: parsed.baseUrl,
    apiKey,
  };
}

async function existingApiKey(record: Awaited<ReturnType<typeof ensureSettingsRecord>>) {
  if (!record?.apiKeyCiphertext) {
    return null;
  }
  try {
    return decryptSecret(record.apiKeyCiphertext);
  } catch {
    throw new SettingsValidationError("已保存的 API Key 无法解密。");
  }
}

function fingerprintConfiguration(input: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}) {
  const stableJson = JSON.stringify([
    input.provider,
    input.baseUrl.trim(),
    input.model.trim(),
    input.apiKey,
  ]);
  return crypto.createHash("sha256").update(stableJson).digest("base64url");
}

export async function effectiveConfiguration(input: unknown) {
  const parsed = parseOrThrow(aiConfigurationSchema, input);
  const record = await getSettingsRecord();
  const apiKey = parsed.apiKey?.trim() || (await existingApiKey(record));
  if (!apiKey) {
    throw new SettingsValidationError("API Key 不能为空。");
  }

  return {
    provider: parsed.provider,
    baseUrl: parsed.baseUrl,
    model: parsed.model,
    apiKey,
  };
}

export async function storedAIConfiguration(): Promise<{
  provider: AIProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  basePrompt: string;
  systemPrompt: string;
} | null> {
  const record = await getSettingsRecord();
  if (
    !record.provider ||
    !record.baseUrl ||
    !record.model ||
    !record.apiKeyCiphertext
  ) {
    return null;
  }

  const provider =
    record.provider === "openai-responses" ||
    record.provider === "anthropic-messages"
      ? record.provider
      : "openai-chat-completions";
  const apiKey = await existingApiKey(record);
  if (!apiKey) {
    return null;
  }

  return {
    provider,
    baseUrl: record.baseUrl,
    model: record.model,
    apiKey,
    basePrompt: record.basePrompt,
    systemPrompt: record.systemPrompt,
  };
}

export function createTestToken(input: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}) {
  return createSignedPayload({
    fingerprint: fingerprintConfiguration(input),
    expiresAt: Date.now() + TEST_TOKEN_TTL_MS,
  });
}

export function verifyTestToken(
  token: string | undefined,
  input: {
    provider: string;
    baseUrl: string;
    model: string;
    apiKey: string;
  },
) {
  const payload = verifySignedPayload<{
    fingerprint?: unknown;
    expiresAt?: unknown;
  }>(token);
  if (
    !payload ||
    typeof payload.fingerprint !== "string" ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt <= Date.now() ||
    payload.fingerprint !== fingerprintConfiguration(input)
  ) {
    throw new SettingsValidationError("当前配置尚未通过连接测试，请先测试。");
  }
}

export async function saveAIConfiguration(
  input: unknown,
  testToken: string | undefined,
) {
  const effective = await effectiveConfiguration(input);
  verifyTestToken(testToken, effective);

  const parsed = parseOrThrow(aiConfigurationSchema, input);
  const apiKeyCiphertext = parsed.apiKey?.trim()
    ? encryptSecret(parsed.apiKey.trim())
    : undefined;

  await store.appSettings.update({
    where: { id: SINGLETON_ID },
    data: {
      provider: effective.provider,
      baseUrl: effective.baseUrl,
      model: effective.model,
      ...(apiKeyCiphertext
        ? {
            apiKeyCiphertext,
            apiKeyLast4: effective.apiKey.slice(-4),
          }
        : {}),
      connectionStatus: "connected",
      connectionCheckedAt: new Date(),
      connectionProvider: effective.provider,
      connectionModel: effective.model,
      connectionError: null,
    },
  });

  return getSafeSettings();
}

export async function effectiveSearchConfiguration(input: unknown) {
  return parseOrThrow(searchConfigurationSchema, input);
}

export async function storedSearchConfiguration(): Promise<{
  provider: "duckduckgo";
  language: "en" | "zh-CN";
}> {
  const record = await getSettingsRecord();
  return {
    provider: record.searchProvider === "duckduckgo" ? "duckduckgo" : "duckduckgo",
    language: record.searchLanguage === "zh-CN" ? "zh-CN" : "en",
  };
}

function fingerprintSearchConfiguration(input: {
  provider: string;
  language: string;
}) {
  const stableJson = JSON.stringify([
    input.provider.trim(),
    input.language.trim(),
  ]);
  return crypto.createHash("sha256").update(stableJson).digest("base64url");
}

export function createSearchTestToken(input: {
  provider: string;
  language: string;
}) {
  return createSignedPayload({
    fingerprint: fingerprintSearchConfiguration(input),
    expiresAt: Date.now() + TEST_TOKEN_TTL_MS,
  });
}

export function verifySearchTestToken(
  token: string | undefined,
  input: { provider: string; language: string },
) {
  const payload = verifySignedPayload<{
    fingerprint?: unknown;
    expiresAt?: unknown;
  }>(token);
  if (
    !payload ||
    typeof payload.fingerprint !== "string" ||
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt <= Date.now() ||
    payload.fingerprint !== fingerprintSearchConfiguration(input)
  ) {
    throw new SettingsValidationError("当前搜索配置尚未通过连接测试，请先测试。");
  }
}

export async function saveSearchConfiguration(
  input: unknown,
  testToken: string | undefined,
) {
  const parsed = await effectiveSearchConfiguration(input);
  await getSettingsRecord();
  verifySearchTestToken(testToken, parsed);

  await store.appSettings.update({
    where: { id: SINGLETON_ID },
    data: {
      searchProvider: parsed.provider,
      searchLanguage: parsed.language,
      searchStatus: "connected",
      searchCheckedAt: new Date(),
      searchError: null,
    },
  });

  return getSafeSettings();
}

export async function savePrompts(input: unknown) {
  const parsed = parseOrThrow(promptSchema, input);
  const record = await getSettingsRecord();
  const promptsChanged =
    parsed.basePrompt !== record.basePrompt ||
    parsed.systemPrompt !== record.systemPrompt;

  if (promptsChanged) {
    await store.appSettings.update({
      where: { id: SINGLETON_ID },
      data: {
        basePrompt: parsed.basePrompt,
        systemPrompt: parsed.systemPrompt,
        promptVersion: { increment: 1 },
      },
    });
  }

  return getSafeSettings();
}

export async function closeSettingsStore() {
  await prisma.$disconnect();
}
