import { z } from "zod";
import { weatherRecordSchema, type WeatherRecord } from "./weather";

export const advisoryCategorySchema = z.enum([
  "weather",
  "reservation",
  "opening_hours",
  "queue",
  "accommodation",
  "transport",
]);
export type AdvisoryCategory = z.infer<typeof advisoryCategorySchema>;

export const advisorySeveritySchema = z.enum(["info", "attention", "action"]);
export type AdvisorySeverity = z.infer<typeof advisorySeveritySchema>;

export const advisoryStatusSchema = z.enum(["active", "known"]);
export type AdvisoryStatus = z.infer<typeof advisoryStatusSchema>;

export const advisoryValiditySchema = z.enum([
  "valid",
  "stale",
  "unknown",
  "failed",
  "out_of_range",
]);
export type AdvisoryValidity = z.infer<typeof advisoryValiditySchema>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确。");

export const advisoryItemSchema = z.object({
  id: z.string().min(1).max(200),
  category: advisoryCategorySchema,
  severity: advisorySeveritySchema,
  status: advisoryStatusSchema,
  validity: advisoryValiditySchema,
  date: dateSchema,
  title: z.string().trim().min(1).max(120),
  targetName: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
  recommendation: z.string().trim().min(1).max(240),
  aiExplanation: z.string().trim().max(160).nullable(),
  eventId: z.string().max(80).nullable(),
  eventIds: z.array(z.string().max(80)).max(32),
  checklistItemId: z.string().max(200).nullable(),
  sourceLabel: z.string().trim().min(1).max(160),
  sourceUrl: z.string().trim().max(2000).nullable(),
  retrievedAt: z.iso.datetime().nullable(),
  applicableFrom: z.iso.datetime().nullable(),
  applicableUntil: z.iso.datetime().nullable(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledged: z.boolean(),
  acknowledgedAt: z.iso.datetime().nullable(),
}).strict();
export type AdvisoryItem = z.infer<typeof advisoryItemSchema>;

export const advisoryAiStatusSchema = z.enum(["not_configured", "used", "failed"]);
export type AdvisoryAiStatus = z.infer<typeof advisoryAiStatusSchema>;

export const advisoryWeatherStateSchema = z.object({
  aiStatus: advisoryAiStatusSchema,
  records: z.array(weatherRecordSchema).max(256),
}).strict();
export type AdvisoryWeatherState = z.infer<typeof advisoryWeatherStateSchema>;

export type AdvisoryView = {
  tripId: string;
  planVersion: number;
  revision: number;
  updatedAt: string | null;
  aiStatus: AdvisoryAiStatus;
  weather: WeatherRecord[];
  missingWeatherEventIds: string[];
  items: AdvisoryItem[];
};

export const advisoryRefreshSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
  expectedRevision: z.number().int().min(0),
}).strict();
export type AdvisoryRefreshInput = z.infer<typeof advisoryRefreshSchema>;

export const advisoryAcknowledgeSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
  expectedRevision: z.number().int().min(0),
  advisoryId: z.string().min(1).max(200),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledged: z.boolean(),
}).strict();
export type AdvisoryAcknowledgeInput = z.infer<typeof advisoryAcknowledgeSchema>;

export const advisoryWriteSchema = z.discriminatedUnion("action", [
  advisoryRefreshSchema.extend({ action: z.literal("refresh") }),
  advisoryAcknowledgeSchema.extend({ action: z.literal("acknowledge") }),
]);
export type AdvisoryWrite = z.infer<typeof advisoryWriteSchema>;

export class AdvisoryError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "AdvisoryError";
  }
}

export const advisoryCategoryLabels: Record<AdvisoryCategory, string> = {
  weather: "天气",
  reservation: "预约",
  opening_hours: "闭馆 / 开放",
  queue: "排队",
  accommodation: "入住 / 寄存",
  transport: "交通",
};

export const advisorySeverityLabels: Record<AdvisorySeverity, string> = {
  info: "可了解",
  attention: "需注意",
  action: "需处理",
};

export const advisoryStatusLabels: Record<AdvisoryStatus, string> = {
  active: "提醒中",
  known: "已知事项",
};

export const advisoryValidityLabels: Record<AdvisoryValidity, string> = {
  valid: "资料适用",
  stale: "资料过期",
  unknown: "资料未知",
  failed: "查询失败",
  out_of_range: "超出预报范围",
};

export function parseAdvisoryItems(value: string): AdvisoryItem[] {
  try {
    return z.array(advisoryItemSchema).max(200).parse(JSON.parse(value));
  } catch {
    throw new AdvisoryError("已保存的提醒记录无法读取，请刷新提醒并保留原行程。", 503);
  }
}

export function parseAdvisoryWeatherState(value: string): AdvisoryWeatherState {
  try {
    return advisoryWeatherStateSchema.parse(JSON.parse(value));
  } catch {
    throw new AdvisoryError("已保存的天气资料无法读取，请刷新提醒；原行程保持不变。", 503);
  }
}
