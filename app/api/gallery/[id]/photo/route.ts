import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { readGalleryPhoto } from "@/lib/gallery-service";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  const photo = await readGalleryPhoto((await params).id);
  return photo ? new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } }) : new Response(null, { status: 404 });
}
