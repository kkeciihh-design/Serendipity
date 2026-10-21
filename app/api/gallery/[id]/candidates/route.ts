import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { findCommonsPhotos, findGalleryDestination } from "@/lib/gallery-service";
import { localFieldnote } from "@/lib/landscape-template";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  const { id } = await params;
  const place = await findGalleryDestination(id);
  if (!place) return Response.json({ error: "画境不存在" }, { status: 404 });
  const query = new URL(request.url).searchParams;
  const refresh = query.get("refresh") === "1";
  const offset = Math.min(264, Math.max(0, Math.trunc(Number(query.get("offset")) || 0)));
  if (!refresh && place.photoCandidates?.length) return Response.json({ candidates: place.photoCandidates.slice(0, 4) });
  const fieldnote = localFieldnote(place.name);
  const candidates = await findCommonsPhotos(place.name, { signal: request.signal, englishName: fieldnote.englishName, limit: 4, offset });
  return Response.json({ candidates });
}
