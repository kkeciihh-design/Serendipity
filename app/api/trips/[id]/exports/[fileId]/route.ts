import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { ExportError } from "@/lib/export-snapshot";
import { getExportFile, getExportImagePart, getExportPdfBytes } from "@/lib/export-service";
import { MOBILE_HTML_CSP } from "@/lib/mobile-export";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = businessRoute(async function GET(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  try {
    const { id, fileId } = await params, file = await getExportFile(id, fileId);
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    if (file.format === "pdf") {
      return new Response(new Uint8Array(getExportPdfBytes(file)), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "Content-Disposition": `${disposition}; filename="${file.filename}"`, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "frame-ancestors 'self'" } });
    }
    if (file.format === "long-image") {
      const part = getExportImagePart(file, Number(new URL(request.url).searchParams.get("part") ?? "1"));
      return new Response(new Uint8Array(part.bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Disposition": `${disposition}; filename="${part.filename}"`, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
    }
    const mime = file.format === "mobile-html" ? "text/html" : file.format === "markdown" ? "text/markdown" : "text/plain";
    return new Response(file.html, { headers: { "Content-Type": `${mime}; charset=utf-8`, "Cache-Control": "no-store",
      "Content-Disposition": `${disposition}; filename="${file.filename}"`, "Content-Security-Policy": `${MOBILE_HTML_CSP}; frame-ancestors 'self'; sandbox`,
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error;
    return Response.json({ error: error instanceof ExportError ? error.message : "文件暂时无法读取，请稍后重试。" }, { status: error instanceof ExportError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
});
