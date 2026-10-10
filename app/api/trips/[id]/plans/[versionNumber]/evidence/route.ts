import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import {
  EvidenceConflictError,
  EvidenceSourceError,
  EvidenceValidationError,
  verifyEvidenceFact,
} from "@/lib/evidence-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; versionNumber: string }>;
};

const bodySchema = z.object({
  eventId: z.string().trim().min(1).max(80),
  field: z.enum(["opening_hours", "reservation", "price", "location"]),
  query: z.string().trim().min(3).max(180),
  officialHost: z.string().trim().min(3).max(160),
});

export async function POST(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id, versionNumber } = await context.params;
    const parsedVersion = Number(versionNumber);
    if (
      !Number.isInteger(parsedVersion) ||
      parsedVersion < 1 ||
      versionNumber !== String(parsedVersion)
    ) {
      return NextResponse.json(
        { error: "计划版本号不正确。" },
        { status: 400 },
      );
    }
    const body = bodySchema.parse(await request.json());
    const fact = await verifyEvidenceFact({
      ...body,
      tripId: id,
      expectedPlanVersion: parsedVersion,
    });
    return NextResponse.json({ fact });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "来源核验请求不合法。" },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，来源核验没有保存。" },
        { status: 400 },
      );
    }
    if (error instanceof EvidenceValidationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }
    if (error instanceof EvidenceConflictError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 },
      );
    }
    if (error instanceof EvidenceSourceError) {
      return NextResponse.json(
        { error: error.message },
        { status: 502 },
      );
    }
    console.error("Evidence verification failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return NextResponse.json(
      { error: "来源核验失败，当前计划没有被覆盖。" },
      { status: 500 },
    );
  }
}
