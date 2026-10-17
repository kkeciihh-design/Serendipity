import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { getDatabasePath } from "@/lib/data-directory";
import { readInstanceState } from "@/scripts/restore-core.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!hasAppAccess(request)) return unauthorizedResponse();
  return Response.json(readInstanceState(getDatabasePath()), { headers: { "Cache-Control": "no-store" } });
}
