import { appWriteAccessError } from "@/lib/access";
import { findGalleryDestination, regenerateDestination } from "@/lib/gallery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 150;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const error = appWriteAccessError(request); if (error) return error;
  const { id } = await params;
  if (!await findGalleryDestination(id)) return Response.json({ error: "画境不存在" }, { status: 404 });
  try {
    return Response.json({ place: await regenerateDestination(id, request.signal) });
  } catch {
    return Response.json({ error: "重新生成失败，请稍后再试。" }, { status: 503 });
  }
}
