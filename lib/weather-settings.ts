import { PrismaClient } from "@prisma/client";
import { createSignedPayload, verifySignedPayload } from "./security";
import { getDatabaseUrl } from "./data-directory";
import { getSettingsRecord, SettingsValidationError } from "./settings";
import {
  fetchOpenMeteoDailyForecast,
  shanghaiDate,
  weatherSummary,
  WEATHER_PROVIDER,
  type WeatherRecord,
} from "./weather";

type PrismaGlobal = typeof globalThis & { serendipityWeatherSettingsPrisma?: PrismaClient };
const prismaGlobal = globalThis as PrismaGlobal;
const prisma = prismaGlobal.serendipityWeatherSettingsPrisma ??
  new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
if (process.env.NODE_ENV !== "production") prismaGlobal.serendipityWeatherSettingsPrisma = prisma;

export type SafeWeatherSettings = {
  provider: "open-meteo";
  status: "not_tested" | "connected" | "failed";
  checkedAt: string | null;
  error: string | null;
};

export async function getSafeWeatherSettings(): Promise<SafeWeatherSettings> {
  const record = await getSettingsRecord();
  const status = record.weatherStatus === "connected" || record.weatherStatus === "failed"
    ? record.weatherStatus
    : "not_tested";
  return {
    provider: WEATHER_PROVIDER,
    status,
    checkedAt: record.weatherCheckedAt?.toISOString() ?? null,
    error: record.weatherError,
  };
}

export async function testWeatherConfiguration(signal?: AbortSignal) {
  const records = await fetchOpenMeteoDailyForecast({
    locationName: "北京（天气连接测试）",
    latitude: 39.9042,
    longitude: 116.4074,
    dates: [shanghaiDate()],
    signal,
  });
  const record = records[0];
  if (!record || record.status !== "fresh") {
    throw new SettingsValidationError(
      `天气连接测试未通过：${record ? weatherSummary(record) : "没有返回当日预报"}。原状态保留。`,
    );
  }
  return {
    testToken: createSignedPayload({ scope: "weather-test", provider: WEATHER_PROVIDER, exp: Date.now() + 10 * 60 * 1000 }),
    record,
    summary: weatherSummary(record),
  };
}

export async function saveWeatherConfiguration(input: unknown) {
  const parsed = input as { testToken?: unknown };
  if (typeof parsed?.testToken !== "string" || !parsed.testToken) {
    throw new SettingsValidationError("请先完成天气连接测试，再保存状态。");
  }
  const token = verifySignedPayload(parsed.testToken);
  if (!token || token.scope !== "weather-test" || token.provider !== WEATHER_PROVIDER ||
    typeof token.exp !== "number" || token.exp <= Date.now()) {
    throw new SettingsValidationError("天气测试已过期，请重新测试。");
  }
  await getSettingsRecord();
  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: {
      weatherProvider: WEATHER_PROVIDER,
      weatherStatus: "connected",
      weatherCheckedAt: new Date(),
      weatherError: null,
    },
  });
  return getSafeWeatherSettings();
}

export async function closeWeatherSettingsStore() {
  await prisma.$disconnect();
}

export type { WeatherRecord };
