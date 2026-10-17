import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  costPaymentStatusSchema,
  costPricingUnitSchema,
} from "@/lib/budget";
import { appWriteAccessError } from "@/lib/access";
import {
  PlanConflictError,
  PlanNotFoundError,
  PlanValidationError,
  savePlanCostEdit,
  savePlanEventEdit,
} from "@/lib/plan-service";
import { planEventStatusSchema } from "@/lib/plan";
import { listEvidenceFacts } from "@/lib/evidence-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; versionNumber: string }>;
};

const eventEditSchema = z.object({
  type: z.literal("event"),
  eventId: z.string().trim().min(1),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "开始时间必须使用 HH:mm。").optional(),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "结束时间必须使用 HH:mm。").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  timeEdit: z.enum(["preserve", "start_duration", "start_end"]).optional(),
  note: z.string().trim().max(240).nullable(),
  locked: z.boolean(),
  status: planEventStatusSchema,
  remove: z.boolean(),
});

const costEditSchema = z.object({
  type: z.literal("cost"),
  costEdit: z.object({
    costId: z.string().trim().min(1),
    unit: costPricingUnitSchema,
    unitAmountCents: z
      .number()
      .int()
      .min(0)
      .max(2_000_000_000)
      .nullable(),
    unitAmountMaxCents: z
      .number()
      .int()
      .min(0)
      .max(2_000_000_000)
      .nullable(),
    quantity: z.number().int().min(1).max(100).nullable(),
    nightCount: z.number().int().min(1).max(4).optional(),
    paymentStatus: costPaymentStatusSchema,
  }),
});

const editSchema = z.discriminatedUnion("type", [
  eventEditSchema,
  costEditSchema,
]);

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

export const PATCH = businessRoute(async function PATCH(request: Request, context: RouteContext) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;

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
    const plan =
      body.type === "event"
        ? await savePlanEventEdit({
            tripId: id,
            expectedPlanVersion: parsedVersion,
            edit: body,
          })
        : await savePlanCostEdit({
            tripId: id,
            expectedPlanVersion: parsedVersion,
            edit: body.costEdit,
          });
    const evidenceFacts = (await listEvidenceFacts(id)).filter((fact) => fact.planVersionId === plan.id);
    return NextResponse.json({ plan: { ...plan, evidenceFacts } });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error;
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
});
