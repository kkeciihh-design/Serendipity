"use client";

import {
  CalendarRange,
  CircleAlert,
  History,
  ListChecks,
  PencilLine,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateBudgetSummary,
  overspendStatusLabels,
  formatMoneyRange,
  type PlanCostItem,
} from "@/lib/budget";
import {
  buildPlanOverviewDays,
  formatBudgetTarget,
  formatPlanPace,
  formatRequestDateRange,
  formatTravelerCount,
  planRequiresUpdate,
  planStatusLabel,
} from "@/lib/plan-overview";
import { PlanBudget } from "./plan-budget";
import { PlanTimeline } from "./plan-timeline";
import type {
  PlanEvent,
  PlanPendingItem,
  PlanValidationResults,
} from "@/lib/plan";
import type { EvidenceFactClient } from "@/lib/evidence";
import type { RequestSnapshot } from "@/lib/trip-request";

export type PlanVersionClient = {
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
  evidenceFacts?: EvidenceFactClient[];
};

export type PlanRequestState = {
  requestRevision: number;
  confirmed: boolean;
  hasUnsavedEdits: boolean;
};

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return (
    payload?.error ??
    `生成失败（HTTP ${response.status}）。已有计划没有被覆盖，请稍后重试。`
  );
}

export function PlanOverview({
  tripId,
  tripTitle,
  plans,
  selectedVersionNumber,
  requestState,
}: {
  tripId: string;
  tripTitle: string;
  plans: PlanVersionClient[];
  selectedVersionNumber: number | null;
  requestState: PlanRequestState;
}) {
  const router = useRouter();
  const currentPlan = plans.find((plan) => plan.isCurrent) ?? null;
  const selectedPlan =
    plans.find(
      (plan) =>
        plan.versionNumber ===
        (selectedVersionNumber ?? currentPlan?.versionNumber),
    ) ?? currentPlan;
  const [previewPlan, setPreviewPlan] = useState<PlanVersionClient | null>(
    selectedPlan,
  );
  const [selectedDayNumber, setSelectedDayNumber] = useState(1);
  const [activeTab, setActiveTab] = useState<"timeline" | "budget">("timeline");
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPreviewPlan(selectedPlan);
    setSelectedDayNumber(1);
  }, [selectedPlan]);

  useEffect(() => {
    if (!isGenerating) {
      setElapsedSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    const controller = abortControllerRef;
    return () => {
      controller.current?.abort();
    };
  }, []);

  const displayPlan = previewPlan ?? selectedPlan;
  const canGenerate =
    !isGenerating && requestState.confirmed && !requestState.hasUnsavedEdits;
  const days = useMemo(
    () =>
      displayPlan
        ? buildPlanOverviewDays(
            displayPlan.events,
            displayPlan.requestSnapshot,
          )
        : [],
    [displayPlan],
  );
  const budgetSummary = useMemo(
    () =>
      displayPlan
        ? calculateBudgetSummary(
            displayPlan.costs,
            displayPlan.requestSnapshot,
          )
        : null,
    [displayPlan],
  );
  const selectedDay =
    days.find((day) => day.dayNumber === selectedDayNumber) ?? days[0] ?? null;
  const requiresUpdate = displayPlan
    ? planRequiresUpdate({
        requestRevision: displayPlan.requestRevision,
        requirementUpToDate: displayPlan.requirementUpToDate,
        latestRequestRevision: requestState.requestRevision,
      })
    : false;
  const statusLabel = planStatusLabel(
    displayPlan,
    requestState.requestRevision,
  );

  const generatePlan = async () => {
    if (!canGenerate) {
      setFeedback({
        tone: "error",
        message: requestState.hasUnsavedEdits
          ? "请先保存并确认最新需求，再生成基础行程。"
          : "只有当前已确认的需求修订才能生成计划。",
      });
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsGenerating(true);
    setFeedback({
      tone: "info",
      message: "正在生成基础行程...页面会保留当前计划，失败不会覆盖。",
    });
    try {
      const response = await fetch(`/api/trips/${tripId}/plans/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRequestRevision: requestState.requestRevision,
          expectedPlanVersion: currentPlan?.versionNumber ?? null,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as {
        plan: PlanVersionClient;
      };
      setPreviewPlan(payload.plan);
      setSelectedDayNumber(1);
      setFeedback({
        tone: payload.plan.validationResults.warnings.length > 0
          ? "info"
          : "success",
        message:
          payload.plan.validationResults.warnings.length > 0
            ? `计划版本 ${payload.plan.versionNumber} 已保存，但存在 ${payload.plan.validationResults.warnings.length} 条需要注意的提醒。`
            : `计划版本 ${payload.plan.versionNumber} 已保存。`,
      });
      router.refresh();
    } catch (error) {
      if (controller.signal.aborted) {
        setFeedback({
          tone: "info",
          message: "已取消本次生成；已有计划保持不变。",
        });
        return;
      }
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "基础行程生成失败，已有计划没有被覆盖。",
      });
    } finally {
      abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  const cancelGeneration = () => {
    abortControllerRef.current?.abort();
  };

  const handlePlanSaved = (savedPlan: PlanVersionClient) => {
    setPreviewPlan(savedPlan);
    router.refresh();
  };

  return (
    <section
      aria-labelledby="plan-overview-title"
      className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-sage">
            <CalendarRange aria-hidden="true" className="size-4 shrink-0" />
            行程总览
          </p>
          <h2
            id="plan-overview-title"
            className="mt-2 break-words text-2xl font-bold leading-8 text-charcoal"
          >
            {displayPlan
              ? `计划版本 ${displayPlan.versionNumber}｜${tripTitle}`
              : `${tripTitle}｜尚无基础计划`}
          </h2>
          {displayPlan ? (
            <p className="mt-2 text-sm leading-6 text-graphite">
              依据需求修订 {displayPlan.requestRevision} 的确认快照生成；
              摘要、每日安排和待确认事项来自同一计划版本。
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span
            className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              !displayPlan || (!displayPlan.isCurrent && !requiresUpdate)
                ? "bg-shell text-graphite"
                : requiresUpdate
                  ? "bg-clay-soft text-clay"
                  : "bg-sage-soft text-sage"
            }`}
          >
            <CircleAlert aria-hidden="true" className="size-4" />
            {statusLabel}
          </span>
          {requestState.hasUnsavedEdits ? (
            <span className="inline-flex min-h-9 items-center rounded-md bg-clay-soft px-3 text-sm text-clay">
              需求修改未保存
            </span>
          ) : null}
          {plans.length > 1 ? (
            <span className="inline-flex items-center gap-2 text-sm text-graphite">
              <History aria-hidden="true" className="size-4" />
              历史版本：
              {plans.map((plan) => (
                <a
                  key={plan.id}
                  href={`/trips/${tripId}?planVersion=${plan.versionNumber}`}
                  className={`rounded px-1 underline-offset-4 hover:underline ${
                    plan.versionNumber === displayPlan?.versionNumber
                      ? "font-semibold text-sage"
                      : "text-graphite"
                  }`}
                >
                  V{plan.versionNumber}
                </a>
              ))}
            </span>
          ) : null}
        </div>
      </div>

      {displayPlan ? (
        <dl className="mt-5 grid gap-x-5 gap-y-4 border-y border-sand/80 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-sm text-graphite">旅行标题</dt>
            <dd className="mt-1 break-words text-base font-semibold text-charcoal">
              {tripTitle}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">目的地</dt>
            <dd className="mt-1 break-words text-base font-semibold text-charcoal">
              {displayPlan.requestSnapshot.destination ?? "未确认"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">日期</dt>
            <dd className="mt-1 text-base font-semibold text-charcoal">
              {formatRequestDateRange(displayPlan.requestSnapshot)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">人数</dt>
            <dd className="mt-1 text-base font-semibold text-charcoal">
              {formatTravelerCount(displayPlan.requestSnapshot)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">节奏</dt>
            <dd className="mt-1 text-base font-semibold text-charcoal">
              {formatPlanPace(displayPlan.requestSnapshot)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-graphite">费用</dt>
            <dd className="mt-1 text-base font-semibold text-charcoal">
              {budgetSummary
                ? `${formatBudgetTarget(displayPlan.requestSnapshot)}｜预计 ${formatMoneyRange(
                    budgetSummary.totalMinCents,
                    budgetSummary.totalMaxCents,
                  )}｜${overspendStatusLabels[budgetSummary.overspendStatus]}`
                : "费用待核算"}
            </dd>
          </div>
        </dl>
      ) : null}

      {displayPlan && requiresUpdate ? (
        <p className="mt-4 rounded-md bg-clay-soft px-4 py-3 text-base leading-7 text-clay">
          最新需求已经变化；本页仍完整展示这个计划自己的确认快照。请回到需求确认区核对、确认新修订，再生成新计划版本。
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={generatePlan}
          disabled={!canGenerate}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
        >
          <Sparkles aria-hidden="true" className="size-5" />
          {isGenerating
            ? `正在生成... ${elapsedSeconds} 秒`
            : currentPlan
              ? `生成新计划版本 V${(currentPlan.versionNumber ?? 0) + 1}`
              : "生成基础行程"}
        </button>
        <a
          href="#request-workspace"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-sage px-5 py-3 text-base font-semibold text-sage transition-colors hover:bg-sage-soft"
        >
          <PencilLine aria-hidden="true" className="size-5" />
          修改需求
        </a>
        <Link
          href="/trips"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-sand px-5 py-3 text-base font-semibold text-graphite transition-colors hover:border-sage hover:text-sage"
        >
          返回旅行列表
        </Link>
        {isGenerating ? (
          <button
            type="button"
            onClick={cancelGeneration}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-clay px-5 py-3 text-base font-semibold text-clay transition-colors hover:bg-clay-soft"
          >
            <XCircle aria-hidden="true" className="size-5" />
            取消生成
          </button>
        ) : null}
      </div>

      <div
        aria-live="polite"
        className={`mt-4 min-h-11 rounded-md px-4 py-3 text-base leading-7 ${
          feedback?.tone === "error"
            ? "bg-clay-soft text-clay"
            : feedback?.tone === "success"
              ? "bg-sage-soft text-sage"
              : "bg-shell text-graphite"
        }`}
      >
        {feedback?.message ??
          "生成会使用当前已确认的需求修订；生成期间需求或计划版本变化时，旧结果会被拒绝。"}
      </div>

      {displayPlan ? (
        <>
          {displayPlan.validationResults.warnings.length > 0 ? (
            <div className="mt-4 rounded-md bg-clay-soft p-4">
              <h3 className="text-base font-semibold text-clay">
                需要注意的校验结果
              </h3>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-charcoal">
                {displayPlan.validationResults.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="计划视图"
                className="inline-flex rounded-md border border-sand bg-cream p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "timeline"}
                  onClick={() => setActiveTab("timeline")}
                  className={`min-h-11 rounded px-4 text-sm font-semibold transition-colors ${
                    activeTab === "timeline"
                      ? "bg-sage text-white"
                      : "text-graphite hover:text-sage"
                  }`}
                >
                  每日时间轴
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "budget"}
                  onClick={() => setActiveTab("budget")}
                  className={`min-h-11 rounded px-4 text-sm font-semibold transition-colors ${
                    activeTab === "budget"
                      ? "bg-sage text-white"
                      : "text-graphite hover:text-sage"
                  }`}
                >
                  预算
                </button>
              </div>
              <p className="text-sm text-graphite">
                共 {days.length} 天｜{displayPlan.events.length} 个日程｜
                {displayPlan.pendingItems.length} 项待确认
              </p>
            </div>

            {activeTab === "timeline" ? (
              <>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  {days.map((day) => (
                    <button
                      key={day.dayNumber}
                      type="button"
                      onClick={() => setSelectedDayNumber(day.dayNumber)}
                      aria-pressed={day.dayNumber === selectedDay?.dayNumber}
                      className={`min-h-16 min-w-40 max-w-72 shrink-0 rounded-md border px-3 py-2 text-left transition-colors ${
                        day.dayNumber === selectedDay?.dayNumber
                          ? "border-sage bg-sage-soft text-sage"
                          : "border-sand bg-cream text-graphite hover:border-sage"
                      }`}
                    >
                      <span className="block text-sm font-semibold">
                        第 {day.dayNumber} 天｜{day.date}
                      </span>
                      <span className="mt-1 block break-words text-sm leading-5">
                        {day.theme}｜{day.events.length} 项
                      </span>
                    </button>
                  ))}
                </div>

                {selectedDay ? (
                  <>
                    <h4 className="mt-5 text-lg font-semibold text-charcoal">
                      第 {selectedDay.dayNumber} 天｜{selectedDay.date}｜
                      {selectedDay.theme}
                    </h4>
                    <PlanTimeline
                      tripId={tripId}
                      plan={displayPlan}
                      day={selectedDay}
                      onSaved={handlePlanSaved}
                    />
                  </>
                ) : null}
              </>
            ) : (
              <PlanBudget
                tripId={tripId}
                plan={displayPlan}
                onSaved={handlePlanSaved}
              />
            )}
          </div>

          <div className="mt-6 rounded-md bg-shell p-4">
            <h3 className="flex items-center gap-2 text-base font-semibold text-charcoal">
              <ListChecks aria-hidden="true" className="size-4 text-sage" />
              待确认事项（{displayPlan.pendingItems.length}）
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-graphite">
              {displayPlan.pendingItems.map((item) => (
                <li key={item.id}>
                  <strong className="text-charcoal">{item.title}</strong>
                  <span className="ml-2">{item.reason}</span>
                  {item.requiredBefore ? (
                    <span className="ml-2 text-sage">
                      建议在 {item.requiredBefore} 前确认
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : (
        <p className="mt-5 rounded-md bg-shell px-4 py-3 text-base leading-7 text-graphite">
          当前还没有保存的基础计划。确认需求修订后，可以生成包含去返程、餐饮、活动、休息、住宿区域和准备事项的基础草稿。
        </p>
      )}
    </section>
  );
}
