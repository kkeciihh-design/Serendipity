import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAppAccess, unauthorizedResponse } from "@/lib/access";
import {
  PlanConflictError,
  PlanNotFoundError,
  PlanValidationError,
  savePlanEventEdit,
} from "@/lib/plan-service";
import { planEventStatusSchema } from "@/lib/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; versionNumber: string }>;
};

const editSchema = z.object({
  eventId: z.string().trim().min(1),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "开始时间必须使用 HH:mm。"),
  durationMinutes: z.number().int().min(1).max(1440),
  note: z.string().trim().max(240).nullable(),
  locked: z.boolean(),
  status: planEventStatusSchema,
  remove: z.boolean(),
});

function editErrorResponse(error: unknown) {
  if (error instanceof PlanNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof PlanValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof PlanConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("Plan edit failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json(
    { error: "保存日程修改失败，当前计划没有被覆盖。" },
    { status: 500 },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
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

    const body = editSchema.parse(await request.json());
    const plan = await savePlanEventEdit({
      tripId: id,
      expectedPlanVersion: parsedVersion,
      edit: body,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "日程修改格式不正确。" },
        { status: 400 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，日程修改没有保存。" },
        { status: 400 },
      );
    }
    return editErrorResponse(error);
  }
}
