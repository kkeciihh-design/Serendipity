"use client";

import {
  Banknote,
  CalendarRange,
  CircleAlert,
  Clock,
  History,
  MapPin,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PlanEvent,
  PlanPendingItem,
  PlanValidationResults,
} from "@/lib/plan";
import type { RequestSnapshot } from "@/lib/trip-request";

export type PlanVersionClient = {
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

export type PlanRequestState = {
  requestRevision: number;
  confirmed: boolean;
  hasUnsavedEdits: boolean;
};

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

const eventTypeLabels: Record<PlanEvent["type"], string> = {
  departure_transport: "去程",
  local_transport: "市内交通",
  return_transport: "返程",
  meal: "餐饮",
  activity: "活动",
  accommodation: "住宿区域",
  rest: "休息",
  preparation: "准备",
};

const costStatusLabels: Record<PlanEvent["costStatus"], string> = {
  estimated: "估算",
  pending_confirmation: "待确认",
  user_confirmed: "已确认",
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

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds} 秒`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours === 0) {
    return `${minutes} 分钟`;
  }
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function formatMoney(cents: number | null) {
  return cents === null ? "待确认" : `约 ${(cents / 100).toFixed(0)} 元`;
}

export function PlanPreview({
  tripId,
  plans,
  selectedVersionNumber,
  requestState,
}: {
  tripId: string;
  plans: PlanVersionClient[];
  selectedVersionNumber: number | null;
  requestState: PlanRequestState;
}) {
  const router = useRouter();
  const currentPlan = plans.find((plan) => plan.isCurrent) ?? null;
  const selectedPlan =
    plans.find(
      (plan) => plan.versionNumber === (selectedVersionNumber ?? currentPlan?.versionNumber),
    ) ?? currentPlan;
  const [previewPlan, setPreviewPlan] = useState<PlanVersionClient | null>(
    selectedPlan,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPreviewPlan(selectedPlan);
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

  const groupedEvents = useMemo(() => {
    if (!displayPlan) {
      return [];
    }
    const days = new Map<number, PlanEvent[]>();
    for (const event of displayPlan.events) {
      const day = days.get(event.dayNumber) ?? [];
      day.push(event);
      days.set(event.dayNumber, day);
    }
    return [...days.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([dayNumber, events]) => ({
        dayNumber,
        events: [...events].sort((left, right) =>
          left.startTime.localeCompare(right.startTime),
        ),
      }));
  }, [displayPlan]);

  return (
    <section
      aria-labelledby="plan-preview-title"
      className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-sage">
            <CalendarRange aria-hidden="true" className="size-4" />
            基础行程预览
          </p>
          <h2
            id="plan-preview-title"
            className="mt-2 text-2xl font-bold leading-8 text-charcoal"
          >
            {displayPlan
              ? `计划版本 ${displayPlan.versionNumber}`
              : "尚无基础计划"}
          </h2>
          {displayPlan ? (
            <p className="mt-2 text-sm text-graphite">
              依据需求修订 {displayPlan.requestRevision} 的确认快照生成；
              目的地 {displayPlan.requestSnapshot.destination ?? "待确认"}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              displayPlan?.requirementUpToDate
                ? "bg-sage-soft text-sage"
                : "bg-clay-soft text-clay"
            }`}
          >
            <CircleAlert aria-hidden="true" className="size-4" />
            {displayPlan
              ? displayPlan.requirementUpToDate
                ? "需求依据当前有效"
                : "旧计划待更新"
              : "等待确认需求"}
          </span>
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

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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

          <div className="mt-5 space-y-5">
            {groupedEvents.map(({ dayNumber, events }) => (
              <div key={dayNumber}>
                <h3 className="flex items-center gap-2 text-lg font-semibold text-charcoal">
                  <Clock aria-hidden="true" className="size-4 text-sage" />
                  第 {dayNumber} 天｜{events[0]?.date}
                </h3>
                <ol className="mt-3 divide-y divide-sand/80 rounded-md border border-sand/80">
                  {events.map((event) => (
                    <li
                      key={event.id}
                      className="grid gap-2 bg-white p-4 sm:grid-cols-[110px_1fr_auto] sm:items-start"
                    >
                      <p className="text-sm font-semibold text-sage">
                        {event.startTime}–{event.endTime}
                      </p>
                      <div>
                        <p className="text-base font-semibold text-charcoal">
                          {event.title}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
                          <span>{eventTypeLabels[event.type]}</span>
                          <span>建议 {formatDuration(event.suggestedDurationSeconds)}</span>
                          {event.locationName ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPin aria-hidden="true" className="size-4" />
                              {event.locationName}
                            </span>
                          ) : null}
                          {event.note ? <span>{event.note}</span> : null}
                        </p>
                      </div>
                      <p className="inline-flex min-h-9 items-center gap-2 rounded-md bg-cream px-3 text-sm text-graphite sm:justify-self-end">
                        <Banknote aria-hidden="true" className="size-4" />
                        {formatMoney(event.costDraftCents)}｜
                        {costStatusLabels[event.costStatus]}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-md bg-shell p-4">
            <h3 className="text-base font-semibold text-charcoal">
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
          确认当前需求修订后，可以生成包含去返程、餐饮、活动、休息、住宿区域和准备事项的基础草稿。
        </p>
      )}
    </section>
  );
}
