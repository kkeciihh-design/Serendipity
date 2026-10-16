import { Prisma, PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "./data-directory";
import { getPlanVersion } from "./plan-service";
import { ChecklistError, checklistWriteSchema, parseChecklistItems, type ChecklistView } from "./checklist";
import { applyChecklistAction } from "./checklist-merge";
import { checklistBasis, projectChecklist } from "./checklist-store";

const shared = globalThis as typeof globalThis & { serendipityChecklistPrisma?: PrismaClient };
const prisma = shared.serendipityChecklistPrisma ?? new PrismaClient({ datasources: { db: { url: getDatabaseUrl() } } });
if (process.env.NODE_ENV !== "production") shared.serendipityChecklistPrisma = prisma;

export async function getChecklist(tripId: string, version: number): Promise<ChecklistView> {
  const plan = await getPlanVersion(tripId, version);
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.findUnique({ where: { id: tripId } });
    if (trip?.currentPlanVersionId !== plan.id) throw new ChecklistError("清单记录当前旅行的准备进度，请返回当前计划查看。", 409);
    const state = await tx.checklistState.findUnique({ where: { tripId } });
    const items = await projectChecklist(tx, state ? parseChecklistItems(state.items) : [], plan);
    return { tripId, planVersion: version, revision: state?.revision ?? 0, updatedAt: state?.updatedAt.toISOString() ?? null,
      items, basis: checklistBasis(items) };
  });
}

export async function saveChecklist(tripId: string, value: unknown, signal?: AbortSignal): Promise<ChecklistView> {
  const input = checklistWriteSchema.parse(value);
  const plan = await getPlanVersion(tripId, input.expectedPlanVersion);
  try {
    return await prisma.$transaction(async (tx) => {
      if (signal?.aborted) throw new ChecklistError("保存请求已取消，请重新读取清单核对。", 409);
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (trip?.currentPlanVersionId !== plan.id) throw new ChecklistError("计划已变化，请刷新页面后核对清单；本次修改未覆盖新计划。", 409);
      const state = await tx.checklistState.findUnique({ where: { tripId } });
      if ((state?.revision ?? 0) !== input.expectedRevision) throw new ChecklistError("清单已在其他页面或计划操作中更新，请重新读取清单后核对再保存。", 409);
      const currentItems = await projectChecklist(tx, state ? parseChecklistItems(state.items) : [], plan);
      if (checklistBasis(currentItems) !== input.expectedBasis) throw new ChecklistError("清单关联资料已变化，请重新读取后核对再保存。", 409);
      const items = applyChecklistAction(currentItems, input.change, plan, new Date().toISOString());
      if (items.length > 2000) throw new ChecklistError("清单历史记录已达上限，请先保留数据并整理旅行。", 409);
      const data = { items: JSON.stringify(items), planVersion: plan.versionNumber };
      let saved;
      if (state) {
        const changed = data.items !== state.items || data.planVersion !== state.planVersion;
        if (changed) {
          const updated = await tx.checklistState.updateMany({ where: { tripId, revision: input.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
          if (updated.count !== 1) throw new ChecklistError("清单已更新，请重新读取后重试。", 409);
        }
        saved = await tx.checklistState.findUniqueOrThrow({ where: { tripId } });
      } else saved = await tx.checklistState.create({ data: { tripId, ...data } });
      return { tripId, revision: saved.revision, planVersion: saved.planVersion, updatedAt: saved.updatedAt.toISOString(), items, basis: checklistBasis(items) };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034", "P2028", "P1008"].includes(error.code)) throw new ChecklistError("清单正被另一项操作更新，请重新读取后重试。", 409);
    throw error;
  }
}
export async function closeChecklistStore() { await prisma.$disconnect(); }
