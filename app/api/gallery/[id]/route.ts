import { appWriteAccessError } from "@/lib/access";
import { findGalleryDestination, galleryIdPattern, galleryUpdateSchema, limitedBytes, removeDestination, updateDestination } from "@/lib/gallery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const error = appWriteAccessError(request); if (error) return error;
  const { id } = await params;
  if (!await findGalleryDestination(id)) return Response.json({ error: "画境不存在" }, { status: 404 });
  try {
    const body = JSON.parse((await limitedBytes(new Response(request.body), 7_100_000)).toString());
    const parsed = galleryUpdateSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "画境参数或照片格式不正确。" }, { status: 400 });
    return Response.json({ place: await updateDestination(id, parsed.data, request.signal) });
  } catch {
    return Response.json({ error: "调校未能保存，请稍后重试。" }, { status: 400 });
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const error = appWriteAccessError(request); if (error) return error;
  const { id } = await params;
  if (!galleryIdPattern.test(id)) return Response.json({ error: "只能移除自定义画境" }, { status: 400 });
  await removeDestination(id); return Response.json({ ok: true });
}
