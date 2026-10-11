import { proxyMapRequest } from "@/lib/map-proxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path;
  if (path[0] === "_AMapService") return proxyMapRequest(request, path.slice(1));
  if (path[0] === "preview" && path[1] === "_AMapService") return proxyMapRequest(request, path.slice(2), true);
  return Response.json({ error: "不支持的地图地址。" }, { status: 404 });
}
