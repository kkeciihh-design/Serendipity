import { NextResponse } from "next/server";
import {
  TripRevisionConflictError,
  TripNotFoundError,
  TripValidationError,
  deleteTrip,
  getTrip,
  updateTrip,
} from "@/lib/trips";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function tripErrorResponse(error: unknown, fallbackStatus: number) {
  if (error instanceof TripValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 },
    );
  }
  if (error instanceof TripNotFoundError) {
    return NextResponse.json(
      { error: error.message },
      { status: 404 },
    );
  }
  if (error instanceof TripRevisionConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("Trip detail operation failed", {
    name: error instanceof Error ? error.name : typeof error,
  });

  return NextResponse.json(
    {
      error:
        fallbackStatus === 500
          ? "保存失败：数据库暂时不可写。你正在编辑的内容没有丢，请稍后重试。"
          : "读取或写入这趟旅行失败，请稍后重试。",
    },
    { status: fallbackStatus },
  );
}

export async function GET(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const trip = await getTrip(id);

    if (!trip) {
      return NextResponse.json(
        { error: "没有找到这趟旅行。" },
        { status: 404 },
      );
    }

    return NextResponse.json({ trip });
  } catch (error) {
    return tripErrorResponse(error, 503);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const body = await request.json();
    const trip = await updateTrip(id, body);
    return NextResponse.json({ trip });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，请重新保存。" },
        { status: 400 },
      );
    }
    return tripErrorResponse(error, 500);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    await deleteTrip(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return tripErrorResponse(error, 500);
  }
}
