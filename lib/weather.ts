import { z } from "zod";

export const WEATHER_PROVIDER = "open-meteo";
export const WEATHER_SOURCE_URL = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确。")
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

export const weatherStatusSchema = z.enum([
  "fresh",
  "stale",
  "out_of_range",
  "failed",
  "unknown",
]);
export type WeatherStatus = z.infer<typeof weatherStatusSchema>;

export const weatherRecordSchema = z.object({
  id: z.string().min(1).max(200),
  provider: z.literal(WEATHER_PROVIDER),
  locationName: z.string().trim().min(1).max(160),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  date: dateSchema,
  status: weatherStatusSchema,
  retrievedAt: z.iso.datetime().nullable(),
  applicableFrom: z.iso.datetime().nullable(),
  applicableUntil: z.iso.datetime().nullable(),
  temperatureMinC: z.number().nullable(),
  temperatureMaxC: z.number().nullable(),
  precipitationSumMm: z.number().min(0).nullable(),
  precipitationProbabilityMax: z.number().min(0).max(100).nullable(),
  weatherCode: z.number().int().min(0).nullable(),
  windSpeedMaxKph: z.number().min(0).nullable(),
  error: z.string().trim().max(240).nullable(),
}).strict();
export type WeatherRecord = z.infer<typeof weatherRecordSchema>;

export class WeatherError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
    this.name = "WeatherError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const openMeteoPayloadSchema = z.object({
  daily: z.object({
    time: z.array(dateSchema),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()),
    weather_code: z.array(z.number().nullable()),
    wind_speed_10m_max: z.array(z.number().nullable()),
  }).strict(),
}).passthrough();

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(date: string, days: number) {
  return shanghaiDate(new Date(Date.parse(`${date}T00:00:00+08:00`) + days * 86_400_000));
}

function dayWindow(date: string) {
  return {
    applicableFrom: new Date(`${date}T00:00:00+08:00`).toISOString(),
    applicableUntil: new Date(`${date}T23:59:59+08:00`).toISOString(),
  };
}

export function effectiveWeatherStatus(
  record: Pick<WeatherRecord, "status" | "retrievedAt" | "date">,
  now = new Date(),
): WeatherStatus {
  if (record.date < shanghaiDate(now) || record.date > addDays(shanghaiDate(now), 15)) return "out_of_range";
  if (record.status !== "fresh" && record.status !== "stale") return record.status;
  if (!record.retrievedAt) return record.status === "fresh" ? "stale" : record.status;
  const age = now.getTime() - new Date(record.retrievedAt).getTime();
  return !Number.isFinite(age) || age < 0 || age >= WEATHER_CACHE_TTL_MS
    ? "stale"
    : "fresh";
}

export function isRainyWeather(record: WeatherRecord) {
  return (
    record.status === "fresh" &&
    ((record.precipitationProbabilityMax ?? 0) >= 50 ||
      (record.precipitationSumMm ?? 0) >= 5 ||
      (record.weatherCode ?? 0) >= 51)
  );
}

export function weatherSummary(record: WeatherRecord) {
  if (record.status === "out_of_range") return "超出预报期限，暂无有效预报";
  if (record.status === "unknown") return record.error || "尚无有效天气资料，请查询预报";
  if (record.status === "failed") return record.error || "天气查询失败";
  if (record.status === "stale") return "天气资料已过期，需重新刷新";
  const parts = [
    record.temperatureMinC !== null && record.temperatureMaxC !== null ? `${Math.round(record.temperatureMinC)}–${Math.round(record.temperatureMaxC)}℃` : "气温未知",
    record.precipitationProbabilityMax !== null ? `降水概率 ${record.precipitationProbabilityMax}%` : "降水概率未知",
    `降水量 ${record.precipitationSumMm ?? "未知"}mm`,
  ];
  return `${parts.join("｜")}（预报）`;
}

async function readJson(response: Response) {
  if (!response.body) throw new WeatherError("天气服务没有返回数据。");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new WeatherError("天气服务响应过大。");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WeatherError("天气服务返回了无法读取的数据。");
  }
}

export function unknownWeatherRecord(input: {
  locationName: string;
  latitude: number;
  longitude: number;
  date: string;
  status: WeatherStatus;
  error?: string | null;
}): WeatherRecord {
  return {
    id: `${input.latitude.toFixed(4)},${input.longitude.toFixed(4)}:${input.date}`,
    provider: WEATHER_PROVIDER,
    locationName: input.locationName,
    latitude: input.latitude,
    longitude: input.longitude,
    date: input.date,
    status: input.status,
    retrievedAt: null,
    applicableFrom: null,
    applicableUntil: null,
    temperatureMinC: null,
    temperatureMaxC: null,
    precipitationSumMm: null,
    precipitationProbabilityMax: null,
    weatherCode: null,
    windSpeedMaxKph: null,
    error: input.error ?? null,
  };
}

export async function fetchOpenMeteoDailyForecast(input: {
  locationName: string;
  latitude: number;
  longitude: number;
  dates: string[];
  now?: Date;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}): Promise<WeatherRecord[]> {
  z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).parse(input);
  const dates = [...new Set(z.array(dateSchema).min(1).max(16).parse(input.dates))].sort();
  const today = shanghaiDate(input.now ?? new Date());
  const lastForecastDate = addDays(today, 15);
  const inRange = dates.filter((date) => date >= today && date <= lastForecastDate);
  const outOfRange = dates.filter((date) => !inRange.includes(date))
    .map((date) => unknownWeatherRecord({
      locationName: input.locationName,
      latitude: input.latitude,
      longitude: input.longitude,
      date,
      status: "out_of_range",
      error: date < today ? "日期已过，不把历史气候当作实时预报" : "超出 Open-Meteo 预报期限",
    }));
  if (!inRange.length) return outOfRange;

  const url = new URL(WEATHER_SOURCE_URL);
  url.searchParams.set("latitude", input.latitude.toFixed(5));
  url.searchParams.set("longitude", input.longitude.toFixed(5));
  url.searchParams.set("start_date", inRange[0]);
  url.searchParams.set("end_date", inRange[inRange.length - 1]);
  url.searchParams.set("daily", [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "precipitation_probability_max",
    "weather_code",
    "wind_speed_10m_max",
  ].join(","));
  url.searchParams.set("timezone", "Asia/Shanghai");

  const request = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await request(url.toString(), {
      signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return [...inRange.map((date) => unknownWeatherRecord({
        locationName: input.locationName, latitude: input.latitude, longitude: input.longitude,
        date, status: "failed", error: "天气查询超时，未获得实时预报",
      })), ...outOfRange];
    }
    return [...inRange.map((date) => unknownWeatherRecord({
      locationName: input.locationName, latitude: input.latitude, longitude: input.longitude,
      date, status: "failed", error: "天气服务连接失败",
    })), ...outOfRange];
  }

  if (!response.ok) {
    const message = `天气服务返回 HTTP ${response.status}`;
    return [...inRange.map((date) => unknownWeatherRecord({
      locationName: input.locationName, latitude: input.latitude, longitude: input.longitude,
      date, status: "failed", error: message,
    })), ...outOfRange];
  }

  try {
    const payload = openMeteoPayloadSchema.parse(await readJson(response));
    const retrievedAt = (input.now ?? new Date()).toISOString();
    const records = payload.daily.time.flatMap((date, index) => {
      if (!inRange.includes(date)) return [];
      const record = weatherRecordSchema.parse({
        ...unknownWeatherRecord({
          locationName: input.locationName, latitude: input.latitude, longitude: input.longitude,
          date, status: "fresh" as const,
        }),
        ...dayWindow(date),
        retrievedAt,
        temperatureMinC: payload.daily.temperature_2m_min[index] ?? null,
        temperatureMaxC: payload.daily.temperature_2m_max[index] ?? null,
        precipitationSumMm: payload.daily.precipitation_sum[index] ?? null,
        precipitationProbabilityMax: payload.daily.precipitation_probability_max[index] ?? null,
        weatherCode: payload.daily.weather_code[index] ?? null,
        windSpeedMaxKph: payload.daily.wind_speed_10m_max[index] ?? null,
        error: null,
      });
      if (record.weatherCode === null || record.temperatureMinC === null || record.temperatureMaxC === null || record.precipitationSumMm === null) throw new Error("missing weather fields");
      return [record];
    });
    if (records.length !== inRange.length || new Set(records.map((r) => r.date)).size !== inRange.length) throw new Error("missing dates");
    return [...records, ...outOfRange];
  } catch {
    return [...inRange.map((date) => unknownWeatherRecord({
      locationName: input.locationName, latitude: input.latitude, longitude: input.longitude,
      date, status: "failed", error: "天气服务返回缺少适用日期或字段",
    })), ...outOfRange];
  }
}

export function parseWeatherRecords(value: string): WeatherRecord[] {
  try {
    return z.array(weatherRecordSchema).max(256).parse(JSON.parse(value));
  } catch {
    throw new WeatherError("已保存的天气资料无法读取，请刷新提醒。", 503);
  }
}

