import { z } from "zod";

export const checklistGroups = { transport: "交通", accommodation: "住宿", reservation: "预约", essentials: "随身物品" } as const;
export const checklistGroupSchema = z.enum(["transport", "accommodation", "reservation", "essentials"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const date = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, "日期不存在。");
export const checklistFieldsSchema = z.object({
  title: z.string().trim().min(1, "请填写事项名称。").max(160),
  group: checklistGroupSchema,
  note: z.string().trim().max(500),
  date: dateSchema.nullable(),
  eventId: z.string().min(1).max(80).nullable(),
}).strict();
export type ChecklistFields = z.infer<typeof checklistFieldsSchema>;
export const checklistItemSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(160), group: checklistGroupSchema, note: z.string().max(500),
  date: dateSchema.nullable(), eventId: z.string().nullable(),
  eventIds: z.array(z.string()), ticketIds: z.array(z.string()),
  source: z.enum(["event", "ticket", "reservation", "rule", "custom"]),
  sourceLabel: z.string(), sourceKey: z.string(), signature: z.string(),
  officialUrl: z.string().nullable(),
  custom: z.boolean(), completed: z.boolean(), completedAt: z.iso.datetime().nullable(),
  deleted: z.boolean(), orphaned: z.boolean(), changeNote: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;
export type ChecklistView = {
  tripId: string; revision: number; planVersion: number; updatedAt: string | null; basis: string;
  items: ChecklistItem[];
};
const itemId = z.string().min(1).max(200);
export const checklistActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync") }).strict(),
  z.object({ action: z.literal("complete"), id: itemId, completed: z.boolean() }).strict(),
  z.object({ action: z.literal("add"), id: z.string().uuid(), fields: checklistFieldsSchema }).strict(),
  z.object({ action: z.literal("edit"), id: itemId, fields: checklistFieldsSchema }).strict(),
  z.object({ action: z.literal("delete"), id: itemId }).strict(),
  z.object({ action: z.literal("restore"), id: itemId }).strict(),
]);
export type ChecklistAction = z.infer<typeof checklistActionSchema>;
export const checklistWriteSchema = z.object({
  expectedPlanVersion: z.number().int().positive(),
  expectedRevision: z.number().int().min(0),
  expectedBasis: z.string().regex(/^[a-f0-9]{64}$/),
  change: checklistActionSchema,
}).strict();
export type ChecklistWrite = z.infer<typeof checklistWriteSchema>;

export class ChecklistError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = "ChecklistError"; }
}

export function parseChecklistItems(value: string): ChecklistItem[] {
  try { return z.array(checklistItemSchema).max(2000).parse(JSON.parse(value)); }
  catch { throw new ChecklistError("已保存的清单无法读取，请保留数据并重试。", 503); }
}
