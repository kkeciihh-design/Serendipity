import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  applyPlanCostEdit,
  CostEditValidationError,
  derivePlanCosts,
  planCostItemSchema,
  validatePlanCosts,
  type PlanCostEditInput,
  type PlanCostItem,
} from "./budget";
import { getDatabaseUrl } from "./data-directory";
import {
  planEventSchema,
  planPendingItemSchema,
  planValidationResultsSchema,
  preparePlanForStorage,
  validatePlan,
  type AIPlanOutput,
  type PlanCapture,
  type PlanEvent,
  type PlanPendingItem,
  type PlanValidationResults,
} from "./plan";
import {
  applyPlanEventEdit,
  planEventEditHasChanges,
  PlanEventFixedError,
  PlanEventLockedError,
  type PlanEventEditInput,
} from "./plan-edit";
import { requestSnapshotSchema, type RequestSnapshot } from "./trip-request";

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

export class PlanConflictError extends Error {
  constructor(
    message = "行程状态已经变化，本次生成结果不能提交，请基于当前状态重试。",
  ) {
    super(message);
    this.name = "PlanConflictError";
  }
}

export class PlanNotFoundError extends Error {
  constructor() {
    super("没有找到这个计划版本。");
    this.name = "PlanNotFoundError";
  }
}

export type PlanVersionRecord = {
  id: string;
  tripId: string;
  versionNumber: number;
  requestRevision: number;
  requestSnapshot: RequestSnapshot;
  events: PlanEvent[];
  costs: PlanCostItem[];
  pendingItems: PlanPendingItem[];
  validationResults: PlanValidationResults;
  requirementUpToDate: boolean;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

type PlanVersionRow = Prisma.PlanVersionGetPayload<{
  include: { trip: { select: { currentPlanVersionId: true } } };
}>;

type PrismaGlobal = typeof globalThis & {
  serendipityPlanPrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;
const prisma =
  prismaGlobal.serendipityPlanPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.serendipityPlanPrisma = prisma;
}

function parseSnapshot(value: string): RequestSnapshot {
  try {
    return requestSnapshotSchema.parse(JSON.parse(value));
  } catch {
    throw new PlanValidationError("已保存的需求快照无法读取。");
  }
}

function parseStoredCosts(value: string, events: PlanEvent[]): PlanCostItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PlanValidationError("计划费用数据无法读取。");
  }

  // 阶段09前创建的计划版本没有费用 JSON；读取时从事件草稿派生，保证旧计划可核算。
  if (Array.isArray(parsed) && parsed.length === 0) {
    return derivePlanCosts(events);
  }

  const result = z.array(planCostItemSchema).safeParse(parsed);
  if (!result.success) {
    throw new PlanValidationError("计划费用数据无法读取。");
  }
  return result.data;
}

function serializePlan(record: PlanVersionRow): PlanVersionRecord {
  try {
    const events = z.array(planEventSchema).parse(JSON.parse(record.events));
    return {
      id: record.id,
      tripId: record.tripId,
      versionNumber: record.versionNumber,
      requestRevision: record.requestRevision,
      requestSnapshot: parseSnapshot(record.requestSnapshot),
      events,
      costs: parseStoredCosts(record.costs, events),
      pendingItems: z
        .array(planPendingItemSchema)
        .parse(JSON.parse(record.pendingItems)),
      validationResults: planValidationResultsSchema.parse(
        JSON.parse(record.validationResults),
      ),
      requirementUpToDate: record.requirementUpToDate,
      isCurrent: record.trip.currentPlanVersionId === record.id,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  } catch {
    throw new PlanValidationError("计划版本数据无法读取。");
  }
}

export async function listPlanVersions(tripId: string) {
  const rows = await prisma.planVersion.findMany({
    where: { tripId },
    include: { trip: { select: { currentPlanVersionId: true } } },
    orderBy: { versionNumber: "desc" },
  });
  return rows.map(serializePlan);
}

export async function getPlanVersion(
  tripId: string,
  versionNumber: number,
) {
  const row = await prisma.planVersion.findUnique({
    where: {
      tripId_versionNumber: { tripId, versionNumber },
    },
    include: { trip: { select: { currentPlanVersionId: true } } },
  });
  if (!row) {
    throw new PlanNotFoundError();
  }
  return serializePlan(row);
}

export async function getPlanGenerationContext(
  tripId: string,
  expectedRequestRevision: number,
): Promise<PlanCapture> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { request: true, currentPlanVersion: true },
  });
  if (!trip) {
    throw new PlanConflictError("没有找到这趟旅行。");
  }
  if (!trip.request) {
    throw new PlanConflictError("没有找到这趟旅行的需求记录。");
  }
  if (trip.request.requestRevision !== expectedRequestRevision) {
    throw new PlanConflictError(
      "需求已修改，请刷新后基于当前修订重新生成计划。",
    );
  }
  if (
    trip.request.confirmedRevision !== expectedRequestRevision ||
    !trip.request.confirmedRequest
  ) {
    throw new PlanConflictError("只有当前已确认的需求修订才能生成计划。");
  }

  return {
    tripId,
    expectedRequestRevision,
    expectedPlanVersion: trip.currentPlanVersion?.versionNumber ?? null,
    requestSnapshot: parseSnapshot(trip.request.confirmedRequest),
    originalRequest: trip.request.originalRequest,
  };
}

export async function savePlanVersion(input: {
  capture: PlanCapture;
  plan: AIPlanOutput;
  validationResults: PlanValidationResults;
  abortSignal?: AbortSignal;
}) {
  if (input.abortSignal?.aborted) {
    throw new PlanConflictError("本次生成已取消，结果不会保存。");
  }
  if (input.validationResults.errors.length > 0) {
    throw new PlanValidationError(input.validationResults.errors[0]);
  }

  const { capture } = input;
  const plan = preparePlanForStorage(input.plan);
  const costs = derivePlanCosts(plan.events);
  const costErrors = validatePlanCosts(costs, plan.events);
  if (costErrors.length > 0) {
    throw new PlanValidationError(costErrors[0]);
  }
  try {
    return await prisma.$transaction(async (transaction) => {
      if (input.abortSignal?.aborted) {
        throw new PlanConflictError("本次生成已取消，结果不会保存。");
      }

      const trip = await transaction.trip.findUnique({
        where: { id: capture.tripId },
        include: { request: true, currentPlanVersion: true },
      });
      if (!trip?.request) {
        throw new PlanConflictError("没有找到这趟旅行或需求记录。");
      }
      if (
        trip.request.requestRevision !== capture.expectedRequestRevision ||
        trip.request.confirmedRevision !== capture.expectedRequestRevision ||
        !trip.request.confirmedRequest ||
        JSON.stringify(capture.requestSnapshot) !==
          trip.request.confirmedRequest
      ) {
        throw new PlanConflictError(
          "需求修订或确认状态已经变化，旧生成结果不能提交。",
        );
      }

      const currentPlanVersion = trip.currentPlanVersion?.versionNumber ?? null;
      if (currentPlanVersion !== capture.expectedPlanVersion) {
        throw new PlanConflictError(
          "当前计划版本已经变化，旧生成结果不能提交。",
        );
      }

      const versionNumber = (capture.expectedPlanVersion ?? 0) + 1;
      const created = await transaction.planVersion.create({
        data: {
          tripId: trip.id,
          versionNumber,
          requestRevision: capture.expectedRequestRevision,
          requestSnapshot: JSON.stringify(capture.requestSnapshot),
          events: JSON.stringify(plan.events),
          costs: JSON.stringify(costs),
          pendingItems: JSON.stringify(plan.pendingItems),
          validationResults: JSON.stringify(input.validationResults),
          requirementUpToDate: true,
        },
      });

      await transaction.trip.update({
        where: { id: trip.id },
        data: {
          currentPlanVersionId: created.id,
          status:
            input.validationResults.warnings.length > 0
              ? "plan_needs_review"
              : "planned",
        },
      });

      const row = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) {
        throw new PlanConflictError();
      }
      return serializePlan(row);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError(
        "当前计划版本已经变化，旧生成结果不能提交。",
      );
    }
    throw error;
  }
}

export async function savePlanEventEdit(input: {
  tripId: string;
  expectedPlanVersion: number;
  edit: PlanEventEditInput;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const row = await transaction.planVersion.findUnique({
        where: {
          tripId_versionNumber: {
            tripId: input.tripId,
            versionNumber: input.expectedPlanVersion,
          },
        },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) {
        throw new PlanNotFoundError();
      }
      if (row.trip.currentPlanVersionId !== row.id) {
        throw new PlanConflictError("只能编辑当前计划版本；历史版本保持只读。");
      }

      const currentPlan = serializePlan(row);
      const sourcePlan: AIPlanOutput = {
        events: currentPlan.events,
        pendingItems: currentPlan.pendingItems,
      };
      if (!planEventEditHasChanges(sourcePlan, input.edit)) {
        throw new PlanValidationError("本次没有需要保存的修改。");
      }

      const editedPlan = preparePlanForStorage(
        applyPlanEventEdit(sourcePlan, input.edit),
      );
      const editedCosts = currentPlan.costs.map((cost) =>
        input.edit.remove && cost.linkedEventId === input.edit.eventId
          ? { ...cost, eventRemoved: true }
          : cost,
      );
      const costErrors = validatePlanCosts(editedCosts, editedPlan.events);
      if (costErrors.length > 0) {
        throw new PlanValidationError(costErrors[0]);
      }
      const validationResults = validatePlan(
        editedPlan,
        currentPlan.requestSnapshot,
      );
      if (validationResults.errors.length > 0) {
        throw new PlanValidationError(validationResults.errors[0]);
      }

      const created = await transaction.planVersion.create({
        data: {
          tripId: row.tripId,
          versionNumber: row.versionNumber + 1,
          requestRevision: row.requestRevision,
          requestSnapshot: row.requestSnapshot,
          events: JSON.stringify(editedPlan.events),
          costs: JSON.stringify(editedCosts),
          pendingItems: JSON.stringify(editedPlan.pendingItems),
          validationResults: JSON.stringify(validationResults),
          requirementUpToDate: row.requirementUpToDate,
        },
      });

      await transaction.trip.update({
        where: { id: row.tripId },
        data: {
          currentPlanVersionId: created.id,
          status: !row.requirementUpToDate
            ? "plan_needs_update"
            : validationResults.warnings.length > 0
              ? "plan_needs_review"
              : "planned",
        },
      });

      const saved = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!saved) {
        throw new PlanConflictError();
      }
      return serializePlan(saved);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError(
        "当前计划版本已经变化，本次编辑不能提交，请刷新后重试。",
      );
    }
    if (
      error instanceof PlanEventLockedError ||
      error instanceof PlanEventFixedError
    ) {
      throw new PlanConflictError(error.message);
    }
    throw error;
  }
}

export async function savePlanCostEdit(input: {
  tripId: string;
  expectedPlanVersion: number;
  edit: PlanCostEditInput;
}) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const row = await transaction.planVersion.findUnique({
        where: {
          tripId_versionNumber: {
            tripId: input.tripId,
            versionNumber: input.expectedPlanVersion,
          },
        },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!row) {
        throw new PlanNotFoundError();
      }
      if (row.trip.currentPlanVersionId !== row.id) {
        throw new PlanConflictError("只能编辑当前计划版本；历史版本保持只读。");
      }

      const currentPlan = serializePlan(row);
      let editedCosts: PlanCostItem[];
      try {
        editedCosts = applyPlanCostEdit(currentPlan.costs, input.edit);
      } catch (error) {
        if (error instanceof CostEditValidationError) {
          throw new PlanValidationError(error.message);
        }
        throw error;
      }
      const costErrors = validatePlanCosts(
        editedCosts,
        currentPlan.events,
      );
      if (costErrors.length > 0) {
        throw new PlanValidationError(costErrors[0]);
      }

      const sourcePlan: AIPlanOutput = {
        events: currentPlan.events,
        pendingItems: currentPlan.pendingItems,
      };
      const validationResults = validatePlan(
        sourcePlan,
        currentPlan.requestSnapshot,
      );
      if (validationResults.errors.length > 0) {
        throw new PlanValidationError(validationResults.errors[0]);
      }

      const created = await transaction.planVersion.create({
        data: {
          tripId: row.tripId,
          versionNumber: row.versionNumber + 1,
          requestRevision: row.requestRevision,
          requestSnapshot: row.requestSnapshot,
          events: row.events,
          costs: JSON.stringify(editedCosts),
          pendingItems: row.pendingItems,
          validationResults: JSON.stringify(validationResults),
          requirementUpToDate: row.requirementUpToDate,
        },
      });

      await transaction.trip.update({
        where: { id: row.tripId },
        data: {
          currentPlanVersionId: created.id,
          status: !row.requirementUpToDate
            ? "plan_needs_update"
            : validationResults.warnings.length > 0
              ? "plan_needs_review"
              : "planned",
        },
      });

      const saved = await transaction.planVersion.findUnique({
        where: { id: created.id },
        include: { trip: { select: { currentPlanVersionId: true } } },
      });
      if (!saved) {
        throw new PlanConflictError();
      }
      return serializePlan(saved);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new PlanConflictError(
        "当前计划版本已经变化，本次费用修改不能提交，请刷新后重试。",
      );
    }
    throw error;
  }
}

export async function markCurrentPlanStale(
  transaction: Prisma.TransactionClient,
  tripId: string,
) {
  const trip = await transaction.trip.findUnique({
    where: { id: tripId },
    select: { currentPlanVersionId: true },
  });
  if (!trip) {
    return;
  }

  await transaction.planVersion.updateMany({
    where: { tripId, requirementUpToDate: true },
    data: { requirementUpToDate: false },
  });
  await transaction.trip.update({
    where: { id: tripId },
    data: {
      status: trip.currentPlanVersionId
        ? "plan_needs_update"
        : "requirement_pending",
    },
  });
}

export async function closePlanStore() {
  await prisma.$disconnect();
}
