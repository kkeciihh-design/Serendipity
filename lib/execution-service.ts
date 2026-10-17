import { businessOperation, businessTransaction } from "./business-guard";
import { Prisma, PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "./data-directory";
import { serializePlan } from "./plan-service";
import { applyExecutionChange, ExecutionError, executionWriteSchema, parseExecution, type ExecutionView } from "./execution";

const shared = globalThis as typeof globalThis & { serendipityExecutionPrisma?: PrismaClient };
const prisma = shared.serendipityExecutionPrisma ?? new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
if (process.env.NODE_ENV !== "production") shared.serendipityExecutionPrisma = prisma;
async function context(tx: Prisma.TransactionClient, tripId: string) {
  const trip = await tx.trip.findUnique({ where: { id: tripId }, include: { currentPlanVersion: true, execution: true } });
  if (!trip) throw new ExecutionError("没有找到这趟旅行。", 404);
  if (!trip.currentPlanVersion) throw new ExecutionError("请先生成旅行计划。", 400);
  return { trip, plan: serializePlan({ ...trip.currentPlanVersion, trip: { currentPlanVersionId: trip.currentPlanVersionId } }) };
}
export const getExecution = businessOperation(async function getExecution(tripId: string) {
  return businessTransaction(prisma, async (tx) => {
    const { trip, plan } = await context(tx, tripId);
    const execution: ExecutionView = { ...parseExecution(trip.execution?.payload), revision: trip.execution?.revision ?? 0,
      planVersion: plan.versionNumber, updatedAt: trip.execution?.updatedAt.toISOString() ?? null };
    return { execution, plan, serverNow: new Date().toISOString() };
  });
});
export const saveExecution = businessOperation(async function saveExecution(tripId: string, raw: unknown, signal?: AbortSignal, now: string = new Date().toISOString()) {
  const input = executionWriteSchema.parse(raw);
  try {
    return await businessTransaction(prisma, async (tx) => {
      if (signal?.aborted) throw new ExecutionError("请求已取消，请重新读取进度核对。");
      const { trip, plan } = await context(tx, tripId);
      if (plan.versionNumber !== input.expectedPlanVersion || (trip.execution?.revision ?? 0) !== input.expectedRevision) throw new ExecutionError("计划或旅行进度已更新，请重新读取后再操作。本次未覆盖新记录。");
      const progress = applyExecutionChange(parseExecution(trip.execution?.payload), plan.events, input.change, now);
      const data = { payload: JSON.stringify(progress), planVersion: plan.versionNumber };
      if (trip.execution) {
        const updated = await tx.executionState.updateMany({ where: { tripId, revision: input.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
        if (updated.count !== 1) throw new ExecutionError("旅行进度刚有更新，请重新读取。");
      } else await tx.executionState.create({ data: { tripId, ...data } });
      if (signal?.aborted) throw new ExecutionError("请求已取消，请重新读取进度核对。");
      const saved = await tx.executionState.findUniqueOrThrow({ where: { tripId } });
      const execution: ExecutionView = { ...progress, planVersion: plan.versionNumber, revision: saved.revision, updatedAt: saved.updatedAt.toISOString() };
      return { execution, plan, serverNow: new Date().toISOString() };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034", "P2028", "P1008"].includes(error.code)) throw new ExecutionError("旅行进度正在更新，请重新读取后再试。");
    throw error;
  }
});
export async function closeExecutionStore() { await prisma.$disconnect(); }
