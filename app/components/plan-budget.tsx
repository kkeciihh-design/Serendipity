"use client";

import {
  BadgeCheck,
  Banknote,
  CircleAlert,
  Coins,
  PencilLine,
  Save,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  calculateBudgetSummary,
  costCategoryLabels,
  costCategoryOrder,
  costCertaintyLabels,
  costItemLineTotals,
  costItemQuantityDescription,
  costPaymentLabels,
  costUnitLabels,
  formatMoneyRange,
  formatMoneyValue,
  overspendStatusLabels,
  type CostPaymentStatus,
  type CostPricingUnit,
  type PlanCostItem,
} from "@/lib/budget";
import type { PlanVersionClient } from "./plan-overview";
import { useVersionedDraft } from "./use-versioned-draft";

type CostDraft = {
  amountYuan: string;
  maxAmountYuan: string;
  unit: CostPricingUnit;
  quantity: string;
  nightCount: string;
  paymentStatus: CostPaymentStatus;
};

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

const pricingUnits: readonly CostPricingUnit[] = [
  "one_time",
  "per_person",
  "per_room_per_night",
  "per_night",
  "per_ticket",
];

const paymentStatuses: readonly CostPaymentStatus[] = [
  "not_paid",
  "paid",
  "refund_pending",
];

function centsToYuanInput(cents: number | null) {
  return cents === null ? "" : `${formatMoneyValue(cents)}`;
}

function createDraft(cost: PlanCostItem, tripNightCount: number): CostDraft {
  return {
    amountYuan: centsToYuanInput(cost.unitAmountCents),
    maxAmountYuan: centsToYuanInput(cost.unitAmountMaxCents),
    unit: cost.unit,
    quantity: cost.quantity === null ? "1" : `${cost.quantity}`,
    nightCount: String(cost.nightCount ?? (
      cost.unit === "per_room_per_night" || cost.unit === "per_night"
        ? Math.max(1, tripNightCount)
        : 1
    )),
    paymentStatus: cost.paymentStatus,
  };
}

function parseYuanToCents(value: string) {
  if (!value.trim()) {
    return null;
  }
  const yuan = Number(value);
  if (!Number.isFinite(yuan) || yuan < 0) {
    return Number.NaN;
  }
  return Math.round(yuan * 100);
}

const draftFieldLabels: Record<keyof CostDraft, string> = {
  amountYuan: "单价", maxAmountYuan: "区间上限", unit: "计价单位", quantity: "票数", nightCount: "计费晚数", paymentStatus: "支付状态",
};
const equalDraftField = (field: keyof CostDraft, left: string, right: string) => {
  if (field === "amountYuan" || field === "maxAmountYuan") {
    const a = parseYuanToCents(left); const b = parseYuanToCents(right);
    return Number.isNaN(a) || Number.isNaN(b) ? left === right : a === b;
  }
  if (field === "quantity" || field === "nightCount") return left.trim() && right.trim() ? Number(left) === Number(right) : left === right;
  return left === right;
};
const incomingDraftValue = (field: keyof CostDraft, value: string) => {
  if (field === "unit") return costUnitLabels[value as CostPricingUnit];
  if (field === "paymentStatus") return costPaymentLabels[value as CostPaymentStatus];
  return value || "（未知）";
};

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return (
    payload?.error ??
    `保存失败（HTTP ${response.status}）。当前计划保持不变，请稍后重试。`
  );
}

export function PlanBudget({
  tripId,
  plan,
  onSaved,
}: {
  tripId: string;
  plan: PlanVersionClient;
  onSaved: (plan: PlanVersionClient) => void;
}) {
  const [selectedCostId, setSelectedCostId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const summary = useMemo(
    () => calculateBudgetSummary(plan.costs, plan.requestSnapshot),
    [plan.costs, plan.requestSnapshot],
  );
  const eventsById = useMemo(
    () => new Map(plan.events.map((event) => [event.id, event])),
    [plan.events],
  );

  const selectedCost = plan.costs.find((cost) => cost.id === selectedCostId);
  const sourceDraft = useMemo(() => selectedCost ? createDraft(selectedCost, summary.factors.nightCount) : null, [selectedCost, summary.factors.nightCount]);
  const { draft, setDraft, resetDraft, acknowledgeSaved, conflicts } = useVersionedDraft({
    scope: tripId, version: plan.id, itemId: selectedCostId, source: sourceDraft, equal: equalDraftField,
  });
  const canEdit = plan.isCurrent;
  const fieldsDisabled = !canEdit || isSaving;

  const saveCost = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedCost || !draft) {
      return;
    }

    const unitAmountCents = parseYuanToCents(draft.amountYuan);
    const unitAmountMaxCents = parseYuanToCents(draft.maxAmountYuan);
    const quantity =
      draft.unit === "per_ticket" ? Number(draft.quantity) : null;
    const nightCount = draft.unit === "per_room_per_night" || draft.unit === "per_night"
      ? Number(draft.nightCount)
      : undefined;
    if (
      Number.isNaN(unitAmountCents) ||
      Number.isNaN(unitAmountMaxCents) ||
      (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) ||
      (nightCount !== undefined && (!Number.isInteger(nightCount) || nightCount < 1 || nightCount > 4))
    ) {
      setFeedback({
        tone: "error",
        message: "金额需为不小于 0 的数字；票数需为正整数，计费晚数需为 1 至 4 的整数。",
      });
      return;
    }

    setIsSaving(true);
    setFeedback({ tone: "info", message: "正在保存费用修改..." });
    try {
      const response = await fetch(
        `/api/trips/${tripId}/plans/${plan.versionNumber}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "cost",
            costEdit: {
              costId: selectedCost.id,
              unit: draft.unit,
              unitAmountCents,
              unitAmountMaxCents,
              quantity,
              nightCount,
              paymentStatus: draft.paymentStatus,
            },
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { plan: PlanVersionClient };
      const savedCost = payload.plan.costs.find((item) => item.id === selectedCost.id);
      if (savedCost) acknowledgeSaved(savedCost.id, createDraft(savedCost, summary.factors.nightCount), payload.plan.id);
      onSaved(payload.plan);
      setFeedback({
        tone: "success",
        message: `计划版本 ${payload.plan.versionNumber} 已保存；费用沿用本计划的需求快照。`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "保存失败。当前计划保持不变，请稍后重试。",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const totalRange = formatMoneyRange(
    summary.totalMinCents,
    summary.totalMaxCents,
  );
  const perPersonRange =
    summary.perPersonMinCents === null
      ? null
      : formatMoneyRange(summary.perPersonMinCents, summary.perPersonMaxCents);

  return (
    <div className="mt-3 space-y-5">
      <section
        aria-labelledby="plan-budget-summary-title"
        className="rounded-md border border-sand/80 bg-cream p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3
              id="plan-budget-summary-title"
              className="flex items-center gap-2 text-lg font-semibold text-charcoal"
            >
              <Coins aria-hidden="true" className="size-5 shrink-0 text-sage" />
              预计费用
            </h3>
            <p className="mt-2 break-words text-2xl font-bold leading-9 text-charcoal">
              {totalRange}
              {summary.totalMinCents !== summary.totalMaxCents ? "（区间）" : ""}
            </p>
            <p className="mt-1 text-sm leading-6 text-graphite">
              人均 {perPersonRange ?? "待确认"}｜
              {summary.factors.travelerCount} 人｜
              {summary.factors.roomCount} 间房｜
              {summary.factors.nightCount} 晚
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span
              className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                summary.overspendStatus === "confirmed"
                  ? "bg-clay text-white"
                  : summary.overspendStatus === "possible"
                    ? "bg-clay-soft text-clay"
                    : "bg-sage-soft text-sage"
              }`}
            >
              {summary.overspendStatus === "confirmed" ? (
                <CircleAlert aria-hidden="true" className="size-4" />
              ) : (
                <BadgeCheck aria-hidden="true" className="size-4" />
              )}
              {overspendStatusLabels[summary.overspendStatus]}
            </span>
            <span className="text-sm text-graphite">
              {summary.budgetTargetCents === null
                ? "预算目标未确认"
                : `预算目标 ${formatMoneyRange(summary.budgetTargetCents, summary.budgetTargetCents)}${
                    summary.budgetScope === "per_person" ? "（人均）" : "（全程）"
                  }`}
            </span>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-graphite">
          已确认 {summary.confirmedItemCount} 项｜待确认{" "}
          {summary.pendingItemCount} 项｜估算 {summary.estimatedItemCount} 项｜
          浮动区间 {summary.rangeItemCount} 项｜
          已支付 {formatMoneyRange(summary.paidMinCents, summary.paidMinCents)}｜
          退款待处理 {summary.refundPendingItemCount} 项
          {summary.unknownItemCount > 0
            ? `｜未知金额 ${summary.unknownItemCount} 项不计入合计`
            : ""}
        </p>
        <p className="mt-2 text-sm leading-6 text-graphite">
          人数、房间、晚数和预算目标读取本计划版本的需求修订{" "}
          {plan.requestRevision} 快照；修改需求请先在需求确认区保存并确认，再生成新计划版本后重算。
        </p>
      </section>

      <section aria-labelledby="plan-budget-categories-title">
        <h3
          id="plan-budget-categories-title"
          className="text-lg font-semibold text-charcoal"
        >
          分类汇总
        </h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.categories.map((category) => (
            <div
              key={category.category}
              className="rounded-md border border-sand/80 bg-white p-4"
            >
              <dt className="text-sm font-semibold text-charcoal">
                {costCategoryLabels[category.category]}
                <span className="ml-2 font-normal text-graphite">
                  {category.itemCount} 项
                </span>
              </dt>
              <dd className="mt-2 text-base font-semibold text-charcoal">
                {formatMoneyRange(
                  category.minTotalCents,
                  category.maxTotalCents,
                )}
              </dd>
              {category.unknownItemCount > 0 ? (
                <dd className="mt-1 text-sm text-clay">
                  {category.unknownItemCount} 项金额未知
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="plan-budget-items-title">
        <h3
          id="plan-budget-items-title"
          className="text-lg font-semibold text-charcoal"
        >
          费用明细
        </h3>
        <div className="mt-3 space-y-4">
          {costCategoryOrder
            .map((category) => ({
              category,
              costs: plan.costs.filter((cost) => cost.category === category),
            }))
            .filter((group) => group.costs.length > 0)
            .map((group) => (
              <div key={group.category}>
                <h4 className="text-sm font-semibold text-sage">
                  {costCategoryLabels[group.category]}
                </h4>
                <ul className="mt-2 space-y-2">
                  {group.costs.map((cost) => {
                    const linkedEvent = eventsById.get(cost.linkedEventId);
                    const line = costItemLineTotals(
                      cost,
                      summary.factors,
                    );
                    return (
                      <li key={cost.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedCostId(cost.id)}
                          aria-expanded={selectedCostId === cost.id}
                          className={`grid w-full gap-2 rounded-md border p-4 text-left transition-colors sm:grid-cols-[1fr_auto] sm:items-center ${
                            selectedCostId === cost.id
                              ? "border-sage bg-sage-soft"
                              : "border-sand/80 bg-white hover:border-sage"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block break-words text-base font-semibold text-charcoal">
                              {linkedEvent?.title ?? "已移除的安排"}
                              {cost.eventRemoved ? "（安排已移除，费用保留）" : ""}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
                              <span>
                                {cost.unitAmountCents === null
                                  ? "金额未知"
                                  : `${formatMoneyRange(
                                      cost.unitAmountCents,
                                      cost.unitAmountMaxCents,
                                    )}/${costUnitLabels[cost.unit]}`}
                              </span>
                              <span>
                                × {costItemQuantityDescription(cost, summary.factors)}
                              </span>
                              <span>
                                ={" "}
                                {formatMoneyRange(line.minCents, line.maxCents)}
                              </span>
                            </span>
                            {cost.note ? <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-clay">{cost.note}</span> : null}
                          </span>
                          <span className="inline-flex min-h-9 items-center gap-2 rounded-md bg-cream px-3 text-sm text-graphite sm:justify-self-end">
                            {costCertaintyLabels[cost.certainty]}｜
                            {costPaymentLabels[cost.paymentStatus]}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
        </div>
      </section>

      {selectedCost && draft ? (
        <section
          aria-labelledby="plan-cost-edit-title"
          className="rounded-md border border-sand/80 bg-cream p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="plan-cost-edit-title"
              className="flex min-w-0 items-center gap-2 text-lg font-semibold text-charcoal"
            >
              <PencilLine aria-hidden="true" className="size-5 shrink-0 text-sage" />
              确认费用：{eventsById.get(selectedCost.linkedEventId)?.title ?? "已移除的安排"}
            </h3>
          </div>

          {conflicts.length > 0 ? <div role="alert" className="mt-4 rounded-md bg-clay-soft px-4 py-3 text-sm leading-6 text-clay">
            <p>新版本也修改了{conflicts.map((field) => draftFieldLabels[field]).join("、")}。你的未保存输入已保留，请核对后保存；选择“恢复原值”可采用新版本的值。</p>
            <ul className="mt-2">{conflicts.map((field) => <li key={field}>新版{draftFieldLabels[field]}：{sourceDraft ? incomingDraftValue(field, sourceDraft[field]) : "（未知）"}</li>)}</ul>
          </div> : null}
          <form onSubmit={saveCost} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-charcoal">
              单价（元，留空表示未知）
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.amountYuan}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  setDraft({ ...draft, amountYuan: event.target.value })
                }
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              />
            </label>
            <label className="block text-sm font-medium text-charcoal">
              区间上限（元，可选）
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={draft.maxAmountYuan}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  setDraft({ ...draft, maxAmountYuan: event.target.value })
                }
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              />
            </label>
            <label className="block text-sm font-medium text-charcoal">
              计价单位
              <select
                value={draft.unit}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    unit: event.target.value as CostPricingUnit,
                  })
                }
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              >
                {pricingUnits.map((unit) => (
                  <option key={unit} value={unit}>
                    {costUnitLabels[unit]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-charcoal">
              票数（按票计价时填写）
              <input
                type="number"
                min={1}
                step={1}
                value={draft.quantity}
                disabled={fieldsDisabled || draft.unit !== "per_ticket"}
                onChange={(event) =>
                  setDraft({ ...draft, quantity: event.target.value })
                }
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              />
            </label>

            {draft.unit === "per_room_per_night" || draft.unit === "per_night" ? (
              <label className="block text-sm font-medium text-charcoal">
                这笔住宿的计费晚数
                <input
                  type="number"
                  min={1}
                  max={4}
                  step={1}
                  value={draft.nightCount}
                  disabled={fieldsDisabled}
                  onChange={(event) => setDraft({ ...draft, nightCount: event.target.value })}
                  className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
                />
                <span className="mt-1 block text-sm font-normal text-graphite">
                  每天单独记录的住宿填 1；同一笔覆盖多晚时填写实际晚数，其他住宿不要重复记录这些晚数。
                </span>
                {selectedCost.nightCount === undefined && (selectedCost.unit === "per_room_per_night" || selectedCost.unit === "per_night") ? (
                  <span className="mt-1 block text-sm font-normal text-clay">
                    这笔旧费用原按全程 {summary.factors.nightCount} 晚计算，请核对实际覆盖晚数后确认。历史版本的金额会保留。
                  </span>
                ) : null}
              </label>
            ) : null}

            <fieldset
              disabled={fieldsDisabled}
              className="rounded-md border border-sand bg-white p-3"
            >
              <legend className="px-1 text-sm font-medium text-charcoal">
                支付状态
              </legend>
              <div className="flex flex-wrap gap-4">
                {paymentStatuses.map((status) => (
                  <label
                    key={status}
                    className="inline-flex min-h-11 items-center gap-2 text-sm text-charcoal"
                  >
                    <input
                      type="radio"
                      name={`cost-payment-${selectedCost.id}`}
                      value={status}
                      checked={draft.paymentStatus === status}
                      onChange={() =>
                        setDraft({ ...draft, paymentStatus: status })
                      }
                      className="size-5 text-sage"
                    />
                    {costPaymentLabels[status]}
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="self-end rounded-md bg-white px-4 py-3 text-sm leading-6 text-graphite">
              保存已知金额会把确定程度记为“已确认”；留空单价表示金额未知，不会当作 0 元。
            </p>

            <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:flex-wrap">
              <button
                type="submit"
                disabled={fieldsDisabled}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70 sm:flex-none"
              >
                <Save aria-hidden="true" className="size-5" />
                {isSaving ? "正在保存..." : "确认金额"}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetDraft();
                  setFeedback(null);
                }}
                disabled={isSaving}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-charcoal/20 bg-white px-5 py-3 text-base font-medium text-charcoal transition-colors hover:border-charcoal disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
              >
                <X aria-hidden="true" className="size-5" />
                恢复原值
              </button>
            </div>
          </form>

          <p
            aria-live="polite"
            className={`mt-3 min-h-11 rounded-md px-4 py-3 text-sm leading-6 ${
              feedback?.tone === "error"
                ? "bg-clay-soft text-clay"
                : feedback?.tone === "success"
                  ? "bg-sage-soft text-sage"
                  : "bg-white text-graphite"
            }`}
          >
            {feedback?.message ??
              (canEdit
                ? "费用确认会生成新的计划版本，并继承当前版本的需求修订和确认快照。"
                : "历史版本只读。")}
          </p>
        </section>
      ) : (
        <p className="mt-3 min-h-11 rounded-md bg-shell px-4 py-3 text-sm leading-6 text-graphite">
          {plan.costs.length > 0
            ? "尚未选择费用项目。"
            : "当前计划没有可核算的费用项目。"}
        </p>
      )}

      {!canEdit ? (
        <p className="inline-flex min-h-9 items-center gap-2 rounded-md bg-clay-soft px-3 text-sm text-clay">
          <CircleAlert aria-hidden="true" className="size-4" />
          历史版本费用只读
        </p>
      ) : null}
      {summary.removedEventItemCount > 0 ? (
        <p className="flex items-start gap-2 text-sm leading-6 text-graphite">
          <Banknote aria-hidden="true" className="mt-1 size-4 shrink-0 text-sage" />
          {summary.removedEventItemCount} 项费用关联的安排已移除；取消安排不等于退款，
          金额和支付状态继续保留在合计中。
        </p>
      ) : null}
    </div>
  );
}
