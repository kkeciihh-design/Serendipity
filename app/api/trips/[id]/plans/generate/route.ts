import { businessRoute } from "@/lib/business-route";
import { RestoreGuardError } from "@/lib/business-guard";
import { NextResponse } from "next/server";
import { appWriteAccessError } from "@/lib/access";
import {
  PlanGenerationError,
  PlanGenerationInProgressError,
  generatePlanVersion,
} from "@/lib/plan-generation";
import {
  PlanConflictError,
  PlanValidationError,
} from "@/lib/plan-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Two 120-second model attempts plus validation and persistence.
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function generationErrorResponse(error: unknown) {
  if (error instanceof PlanGenerationInProgressError) {
    return NextResponse.json({ error: error.message, category: "generation_in_progress" }, { status: 409 });
  }
  if (error instanceof PlanGenerationError) {
    const status =
      error.category === "configuration"
        ? 400
        : error.category === "invalid_output"
          ? 502
          : 502;
    return NextResponse.json({ error: error.message, category: error.category }, { status });
  }
  if (error instanceof PlanValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof PlanConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("Plan generation failed", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return NextResponse.json(
    { error: "基础行程生成失败，已有计划没有被覆盖。" },
    { status: 500 },
  );
}

export const POST = businessRoute(async function POST(request: Request, context: RouteContext) {
  const accessError = appWriteAccessError(request);
  if (accessError) return accessError;

  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      expectedRequestRevision?: unknown;
      expectedPlanVersion?: unknown;
    };
    if (
      typeof body.expectedRequestRevision !== "number" ||
      !Number.isInteger(body.expectedRequestRevision) ||
      body.expectedRequestRevision < 1
    ) {
      return NextResponse.json(
        { error: "请提供当前需求修订号。" },
        { status: 400 },
      );
    }
    if (
      body.expectedPlanVersion !== null &&
      (typeof body.expectedPlanVersion !== "number" ||
        !Number.isInteger(body.expectedPlanVersion) ||
        body.expectedPlanVersion < 1)
    ) {
      return NextResponse.json(
        { error: "请提供当前计划版本号；首次生成时使用 null。" },
        { status: 400 },
      );
    }

    const plan = await generatePlanVersion({
      tripId: id,
      expectedRequestRevision: body.expectedRequestRevision,
      expectedPlanVersion:
        body.expectedPlanVersion === null
          ? null
          : Number(body.expectedPlanVersion),
      abortSignal: request.signal,
    });
    return NextResponse.json({ plan });
  } catch (error) {
    if (error instanceof RestoreGuardError) throw error;
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "请求格式不正确，请重新生成计划。" },
        { status: 400 },
      );
    }
    return generationErrorResponse(error);
  }
});
