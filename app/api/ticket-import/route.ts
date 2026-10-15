import { appWriteAccessError } from "@/lib/access";
import { MAX_TICKET_IMAGE_BYTES, recognizeTicketImage, TicketImageError } from "@/lib/ticket-ocr-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maxBody = Math.ceil(MAX_TICKET_IMAGE_BYTES * 4 / 3) + 2048;

export async function POST(request: Request) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;
  try {
    if (Number(request.headers.get("content-length")) > maxBody) throw new TicketImageError("图片超过 10MB。", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new TicketImageError("请选择图片。");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBody) { await reader.cancel(); throw new TicketImageError("图片超过 10MB。", 413); }
      chunks.push(value);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof payload.image !== "string" || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.image)) {
      throw new TicketImageError("仅支持 PNG、JPEG、WebP 静态图片。");
    }
    const comma = payload.image.indexOf(",");
    const mime = payload.image.slice(5, payload.image.indexOf(";"));
    const bytes = Buffer.from(payload.image.slice(comma + 1), "base64");
    const draft = await recognizeTicketImage(bytes, mime, request.signal);
    return Response.json({ draft }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof TicketImageError ? error.message : "图片请求无法读取，请重新选择。" },
      { status: error instanceof TicketImageError ? error.status : 400, headers: { "Cache-Control": "no-store" } });
  }
}
