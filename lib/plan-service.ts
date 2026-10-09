import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getDatabaseUrl } from "./data-directory";
import {
  planEventSchema,
  planPendingItemSchema,
  planValidationResultsSchema,
  type AIPlanOutput,
  type PlanCapture,
  type PlanEvent,
  type PlanPendingItem,
  type PlanValidationResults,
} from "./plan";
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

function serializePlan(record: PlanVersionRow): PlanVersionRecord {
  try {
    return {
      id: record.id,
      tripId: record.tripId,
      versionNumber: record.versionNumber,
      requestRevision: record.requestRevision,
      requestSnapshot: parseSnapshot(record.requestSnapshot),
      events: z.array(planEventSchema).parse(JSON.parse(record.events)),
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
          events: JSON.stringify(input.plan.events),
          pendingItems: JSON.stringify(input.plan.pendingItems),
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
