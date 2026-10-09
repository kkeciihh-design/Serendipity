import { NextResponse } from "next/server";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import {
  TripRequestConflictError,
  TripRequestValidationError,
  getTripRequestRecord,
  saveRequestDraft,
} from "@/lib/trip-request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function requestErrorResponse(error: unknown) {
  if (error instanceof TripRequestValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof TripRequestConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("Trip request operation failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json(
    { error: "需求保存失败，请稍后重试；未保存内容不会丢失。" },
    { status: 500 },
  );
}

export async function GET(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const tripRequest = await getTripRequestRecord(id);
    return NextResponse.json({ request: tripRequest });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const tripRequest = await saveRequestDraft(id, body);
    return NextResponse.json({ request: tripRequest });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，请重新保存。" },
        { status: 400 },
      );
    }
    return requestErrorResponse(error);
  }
}
