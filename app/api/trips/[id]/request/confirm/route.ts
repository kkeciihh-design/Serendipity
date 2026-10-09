import { NextResponse } from "next/server";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import {
  TripRequestConflictError,
  TripRequestValidationError,
  confirmRequest,
} from "@/lib/trip-request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function confirmErrorResponse(error: unknown) {
  if (error instanceof TripRequestValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof TripRequestConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("Trip request confirmation failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json(
    { error: "需求确认失败，请稍后重试。" },
    { status: 500 },
  );
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const tripRequest = await confirmRequest(id, body);
    return NextResponse.json({ request: tripRequest });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，请重新确认。" },
        { status: 400 },
      );
    }
    return confirmErrorResponse(error);
  }
}
