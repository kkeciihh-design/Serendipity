import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { effectiveEvidenceStatus, reservationRequirement } from "./evidence";
import { ChecklistError, parseChecklistItems } from "./checklist";
import { mergeChecklist } from "./checklist-merge";
import { sanitizeTravelerText } from "./content-sanitizer";
import type { PlanVersionRecord } from "./plan-service";

export const checklistBasis = (items: ReturnType<typeof parseChecklistItems>) => createHash("sha256")
  .update(JSON.stringify(items.map((item) => Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))))).digest("hex");

export async function projectChecklist(transaction: Prisma.TransactionClient, previous: ReturnType<typeof parseChecklistItems>, plan: PlanVersionRecord) {
  const facts = await transaction.evidenceFact.findMany({ where: { planVersionId: plan.id, field: "reservation" } });
  const merged = mergeChecklist(previous, plan, facts.map((fact) => {
    const effective = effectiveEvidenceStatus({ ...fact, field: "reservation", status: fact.status === "verified" ? "verified" : fact.status === "conflict" ? "conflict" : "unverified", applicableFrom: fact.applicableFrom?.toISOString() ?? null, applicableUntil: fact.applicableUntil?.toISOString() ?? null });
    const requirement = ["required", "not_required"].includes(fact.extractedValue) ? fact.extractedValue : reservationRequirement(fact.extractedValue);
    return { eventId: fact.targetId, required: effective === "verified" ? requirement === "required" ? true : requirement === "not_required" ? false : null : null,
      text: fact.contentQuote || fact.extractedValue, sourceLabel: `来自预约来源资料 · ${effective === "verified" ? "适用要求已核验；办理结果需自行确认" : "要求待复核"}` };
  }));
  return merged.map((item) => ({
    ...item,
    title: sanitizeTravelerText(item.title),
    note: item.note ? sanitizeTravelerText(item.note) : item.note,
    sourceLabel: sanitizeTravelerText(item.sourceLabel),
  }));
}

// Called inside every plan commit: the latest preparation progress and the new
// plan are committed together. No model output supplies completion state.
export async function syncPlanChecklist(transaction: Prisma.TransactionClient, plan: PlanVersionRecord) {
  const state = await transaction.checklistState.findUnique({ where: { tripId: plan.tripId } });
  const items = await projectChecklist(transaction, state ? parseChecklistItems(state.items) : [], plan);
  if (items.length > 2000) throw new ChecklistError("清单历史记录已达上限，请先保留数据并整理旅行。", 409);
  const data = { items: JSON.stringify(items), planVersion: plan.versionNumber };
  if (state) {
    const updated = await transaction.checklistState.updateMany({
      where: { tripId: plan.tripId, revision: state.revision }, data: { ...data, revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ChecklistError("清单刚有修改，请重新读取计划后重试。", 409);
  } else await transaction.checklistState.create({ data: { ...data, tripId: plan.tripId } });
}
