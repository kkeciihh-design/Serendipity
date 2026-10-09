import { NextResponse } from "next/server";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import {
  PlanNotFoundError,
  PlanValidationError,
  listPlanVersions,
} from "@/lib/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function plansErrorResponse(error: unknown) {
  if (error instanceof PlanNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof PlanValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error("Plan list operation failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json(
    { error: "读取计划版本失败，请稍后重试。" },
    { status: 500 },
  );
}

export async function GET(request: Request, context: RouteContext) {
  if (!hasAppAccess(request)) {
    return unauthorizedResponse();
  }

  try {
    const { id } = await context.params;
    const plans = await listPlanVersions(id);
    return NextResponse.json({ plans });
  } catch (error) {
    return plansErrorResponse(error);
  }
}
