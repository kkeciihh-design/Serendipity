import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { getRuntimeInfo } from "@/lib/runtime-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    return Response.json(getRuntimeInfo(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unhealthy", error: "旅行数据暂时无法读取，请查看桌面运行状态。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
