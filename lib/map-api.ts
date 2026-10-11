import { MapServiceError } from "./amap";
import { PlanConflictError, PlanNotFoundError, PlanValidationError } from "./plan-service";
import { SettingsValidationError } from "./settings";

export function mapApiError(error: unknown) {
  if (error instanceof PlanConflictError) return Response.json({ error: error.message }, { status: 409 });
  if (error instanceof PlanNotFoundError) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof SettingsValidationError || error instanceof PlanValidationError || error instanceof SyntaxError) return Response.json({ error: error instanceof SyntaxError ? "请求格式不正确。" : error.message }, { status: 400 });
  if (error instanceof MapServiceError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: "地图操作失败，已有计划和配置保持不变，请重试。" }, { status: 503 });
}
