import { NextResponse } from "next/server";
import {
  TripValidationError,
  createTrip,
  listTrips,
} from "@/lib/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tripErrorResponse(error: unknown, fallbackStatus: number) {
  if (error instanceof TripValidationError) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 },
    );
  }

  console.error("Trip list/create failed", {
    name: error instanceof Error ? error.name : typeof error,
  });

  return NextResponse.json(
    {
      error:
        fallbackStatus === 500
          ? "保存失败：数据库暂时不可写。你输入的内容没有丢，请稍后重试。"
          : "读取旅行列表失败，请稍后重试。",
    },
    { status: fallbackStatus },
  );
}

export async function GET() {
  try {
    const trips = await listTrips();
    return NextResponse.json({ trips });
  } catch (error) {
    return tripErrorResponse(error, 503);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const trip = await createTrip(body);
    return NextResponse.json({ trip }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，请重新提交。" },
        { status: 400 },
      );
    }
    return tripErrorResponse(error, 500);
  }
}
