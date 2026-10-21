import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { NextResponse } from "next/server";
import { cleanupDuplicateTrips } from "@/lib/trips";
import { appWriteAccessError } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = businessRoute(async function POST(request: Request) {
  const denied = appWriteAccessError(request);
  if (denied) return denied;

  try {
    return NextResponse.json(await cleanupDuplicateTrips());
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error;
    console.error("Trip cleanup failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "清理失败，旅行资料保持不变，请稍后重试。" },
      { status: 500 },
    );
  }
});
