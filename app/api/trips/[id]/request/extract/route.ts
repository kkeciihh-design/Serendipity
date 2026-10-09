import { NextResponse } from "next/server";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import { extractTripRequest, TripRequestExtractionError } from "@/lib/requirement-extraction";
import {
  TripRequestConflictError,
  TripRequestValidationError,
} from "@/lib/trip-request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function extractionErrorResponse(error: unknown) {
  if (error instanceof TripRequestExtractionError) {
    const status =
      error.category === "configuration"
        ? 400
        : error.category === "invalid_output"
          ? 502
          : 502;
    return NextResponse.json({ error: error.message }, { status });
  }
  if (error instanceof TripRequestValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof TripRequestConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("Trip request extraction failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json(
    { error: "AI 需求理解失败，当前需求没有被覆盖。" },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      expectedRequestRevision?: unknown;
    };
    const expectedRequestRevision = body.expectedRequestRevision;
    if (
      typeof expectedRequestRevision !== "number" ||
      !Number.isInteger(expectedRequestRevision) ||
      expectedRequestRevision < 1
    ) {
      return NextResponse.json(
        { error: "请提供当前需求修订号。" },
        { status: 400 },
      );
    }

    const tripRequest = await extractTripRequest(id, expectedRequestRevision);
    return NextResponse.json({ request: tripRequest });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，请重新理解需求。" },
        { status: 400 },
      );
    }
    return extractionErrorResponse(error);
  }
}
