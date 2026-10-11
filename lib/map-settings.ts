import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getDatabaseUrl } from "./data-directory";
import { getSettingsRecord, SettingsValidationError } from "./settings";
import { createSignedPayload, decryptSecret, encryptSecret, verifySignedPayload } from "./security";
import { probeStaticMap, searchAmapPlaces } from "./amap";

const prismaGlobal = globalThis as typeof globalThis & { serendipityMapSettingsPrisma?: PrismaClient };
const prisma = prismaGlobal.serendipityMapSettingsPrisma ?? new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
if (process.env.NODE_ENV !== "production") prismaGlobal.serendipityMapSettingsPrisma = prisma;
const key = z.string().trim().regex(/^[A-Za-z0-9_-]{16,160}$/, "请填写正确的高德密钥。");
export const mapConfigurationSchema = z.object({ browserKey: key, webServiceKey: key, securityCode: key });
export type MapConfiguration = z.infer<typeof mapConfigurationSchema>;
export const MAP_PREVIEW_COOKIE = "serendipity_map_preview";
const TTL = 10 * 60 * 1000;
const fingerprint = (config: MapConfiguration) => crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
export type SafeMapSettings = {
  provider: "osm" | "amap";
  configured: boolean; checkedAt: string | null;
  capabilities: { search: boolean; staticMap: boolean; browserMap: boolean; exportPermission: "unconfirmed" } | null;
};

export async function getSafeMapSettings(): Promise<SafeMapSettings> {
  const record = await getSettingsRecord();
  return { provider: record.mapProvider === "amap" ? "amap" : "osm", configured: Boolean(record.mapConfigurationCiphertext), checkedAt: record.mapCheckedAt?.toISOString() ?? null,
    capabilities: record.mapCapabilities ? JSON.parse(record.mapCapabilities) : null };
}

export async function getMapConfiguration(): Promise<MapConfiguration> {
  const record = await getSettingsRecord();
  if (!record.mapConfigurationCiphertext) throw new SettingsValidationError("请先在设置页配置高德地图并完成连接测试。");
  try { return mapConfigurationSchema.parse(JSON.parse(decryptSecret(record.mapConfigurationCiphertext))); }
  catch { throw new SettingsValidationError("地图配置无法读取，请在设置页重新配置。"); }
}

export function readMapPreview(cookie: string | null) {
  try {
    const payload = JSON.parse(decryptSecret(cookie ?? ""));
    if (payload.scope !== "map-preview" || typeof payload.exp !== "number" || payload.exp <= Date.now()) throw new Error();
    return mapConfigurationSchema.parse(payload.configuration);
  } catch { throw new SettingsValidationError("地图测试已过期，请重新测试。"); }
}

export async function testMapConfiguration(input: unknown, signal?: AbortSignal) {
  const raw = z.object({ browserKey: z.string().max(160), webServiceKey: z.string().max(160), securityCode: z.string().max(160) }).safeParse(input);
  if (!raw.success) throw new SettingsValidationError("请填写三项地图配置。");
  let existing: MapConfiguration | null = null;
  if (Object.values(raw.data).some((value) => !value.trim())) {
    try { existing = await getMapConfiguration(); } catch { /* New configuration must provide every key. */ }
  }
  const parsed = mapConfigurationSchema.safeParse({
    browserKey: raw.data.browserKey.trim() || existing?.browserKey,
    webServiceKey: raw.data.webServiceKey.trim() || existing?.webServiceKey,
    securityCode: raw.data.securityCode.trim() || existing?.securityCode,
  });
  if (!parsed.success) throw new SettingsValidationError("需要浏览器 Key、Web 服务 Key 和 JS API 安全密钥；已保存的项可留空沿用。");
  const configuration = parsed.data;
  if (configuration.browserKey === configuration.webServiceKey) throw new SettingsValidationError("浏览器 Key 与 Web 服务 Key 类型不同，请分别创建。");
  const places = await searchAmapPlaces(configuration.webServiceKey, "深圳", "深圳站", signal);
  if (!places.some((place) => place.city.includes("深圳"))) throw new SettingsValidationError("地点查询没有返回深圳市候选，测试未通过。");
  const staticMap = await probeStaticMap(configuration.webServiceKey, signal);
  const exp = Date.now() + TTL;
  return {
    previewCookie: encryptSecret(JSON.stringify({ scope: "map-preview", configuration, exp })),
    testToken: createSignedPayload({ scope: "map-test", fingerprint: fingerprint(configuration), exp }),
    staticMap,
  };
}

export async function saveMapConfiguration(cookie: string | null, input: unknown) {
  const parsed = z.object({ testToken: z.string().max(2000), browserMapLoaded: z.literal(true) }).safeParse(input);
  if (!parsed.success) throw new SettingsValidationError("请先完成地点查询、静态图与浏览器地图测试。");
  const configuration = readMapPreview(cookie);
  const token = verifySignedPayload(parsed.data.testToken);
  if (!token || token.scope !== "map-test" || typeof token.exp !== "number" || token.exp <= Date.now() || token.fingerprint !== fingerprint(configuration)) {
    throw new SettingsValidationError("地图测试与配置不一致，请重新测试。");
  }
  await getSettingsRecord();
  await prisma.appSettings.update({ where: { id: "singleton" }, data: {
    mapProvider: "amap", mapConfigurationCiphertext: encryptSecret(JSON.stringify(configuration)), mapCheckedAt: new Date(),
    mapCapabilities: JSON.stringify({ search: true, staticMap: true, browserMap: true, exportPermission: "unconfirmed" }),
  } });
  return getSafeMapSettings();
}

export async function closeMapSettingsStore() { await prisma.$disconnect(); }

export async function useFreeMapProvider() {
  await getSettingsRecord();
  await prisma.appSettings.update({ where: { id: "singleton" }, data: { mapProvider: "osm" } });
  return getSafeMapSettings();
}
