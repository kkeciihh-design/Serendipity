import { appWriteAccessError, hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { galleryInputSchema, galleryPayload, generateDestination, limitedBytes } from "@/lib/gallery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
let generating = false;
export async function GET(request: Request) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  return Response.json(await galleryPayload());
}
export async function POST(request: Request) {
  const error = appWriteAccessError(request); if (error) return error;
  if (generating) return Response.json({ error: "另一幅画境正在生成，请稍候。" }, { status: 429 });
  generating = true;
  try {
    const body = JSON.parse((await limitedBytes(new Response(request.body), 7_100_000)).toString());
    const parsed = galleryInputSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "请填写 1–60 字景点名称，偏好不超过 240 字，照片不超过 5 MB。" }, { status: 400 });
    return Response.json({ place: await generateDestination(parsed.data, request.signal) }, { status: 201 });
  } catch { return Response.json({ error: "暂未保存画境。请检查照片格式与大小，或稍后再试；已收藏的风景保持完整。" }, { status: 400 }); }
  finally { generating = false; }
}
