import { z } from "zod";
import { searchAmapPlaces } from "./amap";
import { getMapConfiguration } from "./map-settings";
import { getSettingsRecord } from "./settings";
import { searchOsmPlaces } from "./osm";
import { getPlanVersion, PlanConflictError, PlanValidationError, savePlanPlaceEdit } from "./plan-service";
import { placeCandidateSchema } from "./places";
import { createSignedPayload, verifySignedPayload } from "./security";

export const mapSearchSchema = z.object({
  eventId: z.string().min(1).max(80), city: z.string().trim().min(1, "请填写地点所在城市。").max(100),
  keywords: z.string().trim().min(1, "请填写地点名称。").max(120),
});

export async function searchPlanPlaces(tripId: string, version: number, input: unknown, signal?: AbortSignal) {
  const parsed = mapSearchSchema.safeParse(input);
  if (!parsed.success) throw new PlanValidationError(parsed.error.issues[0]?.message ?? "地点查询格式不正确。");
  const { eventId, city, keywords } = parsed.data;
  const assertCurrent = async () => {
    const plan = await getPlanVersion(tripId, version);
    if (!plan.isCurrent) throw new PlanConflictError("计划已变化，请刷新后重新搜索。");
    const event = plan.events.find((event) => event.id === eventId);
    if (!event) throw new PlanValidationError("没有找到这项安排。");
    if (event.locked || event.status === "confirmed") throw new PlanConflictError("这项安排已锁定或确认，请先在时间轴解除后再修改地点。");
  };
  await assertCurrent();
  const settings = await getSettingsRecord();
  const candidates = settings.mapProvider === "amap"
    ? await searchAmapPlaces((await getMapConfiguration()).webServiceKey, city, keywords, signal)
    : await searchOsmPlaces(city, keywords, signal);
  await assertCurrent();
  if (signal?.aborted) throw new PlanConflictError("本次地点查询已取消。");
  return candidates.map((candidate) => ({ ...candidate, selectionToken: createSignedPayload({
    scope: "place-selection", tripId, version, eventId, city, keywords, candidate, exp: Date.now() + 10 * 60 * 1000,
  }) }));
}

export async function confirmPlanPlace(tripId: string, version: number, input: unknown, signal?: AbortSignal) {
  const parsed = z.object({ eventId: z.string().min(1).max(80), selectionToken: z.string().max(6000).nullable(),
    precision: z.enum(["poi", "area_reference"]),
  }).strict().safeParse(input);
  if (!parsed.success) throw new PlanValidationError("地点确认格式不正确。");
  const { eventId, selectionToken, precision } = parsed.data;
  let candidate = null;
  if (selectionToken) {
    const token = verifySignedPayload(selectionToken);
    if (!token || token.scope !== "place-selection" || token.tripId !== tripId || token.version !== version || token.eventId !== eventId || typeof token.exp !== "number" || token.exp <= Date.now()) {
      throw new PlanConflictError("候选地点已过期或不属于当前安排，请重新搜索。");
    }
    const result = placeCandidateSchema.safeParse(token.candidate);
    if (!result.success) throw new PlanValidationError("候选地点不完整，请重新搜索。");
    candidate = result.data;
    if (/地名地址|行政地名|boundary:|place:(city|town|village|suburb|neighbourhood|quarter|county|state)/.test(candidate.category) && precision !== "area_reference") {
      throw new PlanValidationError("区域类地点只能保存为区域参考点，不能冒充精确酒店或站点。");
    }
  }
  return savePlanPlaceEdit({ tripId, expectedPlanVersion: version, eventId, candidate, precision, abortSignal: signal });
}
