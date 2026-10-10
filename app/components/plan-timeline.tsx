"use client";

import {
  ArrowDown,
  Banknote,
  CircleAlert,
  Lock,
  LockOpen,
  PencilLine,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  formatMoneyAmount,
  formatPlanEventTimeRange,
  type PlanOverviewDay,
} from "@/lib/plan-overview";
import {
  planEventEnd,
  planEventStart,
  sortPlanEvents,
  type PlanEvent,
  type PlanEventStatus,
} from "@/lib/plan";
import type { PlanVersionClient } from "./plan-overview";

const eventTypeLabels: Record<PlanEvent["type"], string> = {
  departure_transport: "去程",
  local_transport: "市内交通",
  return_transport: "返程",
  meal: "餐饮",
  activity: "活动",
  accommodation: "住宿约束",
  rest: "休息",
  preparation: "准备",
};

const costStatusLabels: Record<PlanEvent["costStatus"], string> = {
  estimated: "估算",
  pending_confirmation: "待确认",
  user_confirmed: "已确认",
};

const eventStatusLabels: Record<PlanEventStatus, string> = {
  suggested: "AI建议",
  confirmed: "已确认",
};

type Draft = {
  startTime: string;
  durationMinutes: number;
  note: string;
  locked: boolean;
  status: PlanEventStatus;
};

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

function createDraft(event: PlanEvent): Draft {
  return {
    startTime: event.startTime,
    durationMinutes: Math.max(
      1,
      Math.round(event.suggestedDurationSeconds / 60),
    ),
    note: event.note ?? "",
    locked: event.locked ?? false,
    status: event.status ?? "suggested",
  };
}

function formatGap(minutes: number) {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

function connectionLabel(current: PlanEvent, next: PlanEvent) {
  const gapMinutes = Math.round(
    (planEventStart(next).getTime() - planEventEnd(current).getTime()) /
      60_000,
  );
  if (gapMinutes < 0) {
    return "时段冲突，请修改";
  }
  return `${
    gapMinutes === 0 ? "直接衔接" : `衔接 ${formatGap(gapMinutes)}`
  }｜路线未核验`;
}

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return (
    payload?.error ??
    `保存失败（HTTP ${response.status}）。当前计划保持不变，请稍后重试。`
  );
}

export function PlanTimeline({
  tripId,
  plan,
  day,
  onSaved,
}: {
  tripId: string;
  plan: PlanVersionClient;
  day: PlanOverviewDay;
  onSaved: (plan: PlanVersionClient) => void;
}) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [removeRequested, setRemoveRequested] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const nextDayFirstEvent = useMemo(() => {
    const nextDayEvents = plan.events.filter(
      (event) => event.dayNumber === day.dayNumber + 1,
    );
    return sortPlanEvents(nextDayEvents)[0];
  }, [plan.events, day.dayNumber]);

  useEffect(() => {
    const event = plan.events.find((item) => item.id === selectedEventId);
    if (!event) {
      setSelectedEventId(null);
      setDraft(null);
      setRemoveRequested(false);
      return;
    }
    setDraft(createDraft(event));
    setRemoveRequested(false);
  }, [plan, selectedEventId]);

  const selectedEvent = plan.events.find(
    (event) => event.id === selectedEventId,
  );
  const canEdit = plan.isCurrent;
  const originalLocked = selectedEvent?.locked ?? false;
  const fixedEvent =
    selectedEvent?.type === "departure_transport" ||
    selectedEvent?.type === "return_transport";
  const fieldsDisabled = !canEdit || isSaving || originalLocked;

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedEvent || !draft) {
      return;
    }

    setIsSaving(true);
    setFeedback({ tone: "info", message: "正在保存日程修改..." });
    try {
      const response = await fetch(
        `/api/trips/${tripId}/plans/${plan.versionNumber}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "event",
            eventId: selectedEvent.id,
            startTime: draft.startTime,
            durationMinutes: draft.durationMinutes,
            note: draft.note.trim() ? draft.note : null,
            locked: draft.locked,
            status: draft.status,
            remove: removeRequested,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { plan: PlanVersionClient };
      onSaved(payload.plan);
      setFeedback({
        tone: "success",
        message: `计划版本 ${payload.plan.versionNumber} 已保存。`,
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

  return (
    <div>
      <ol className="mt-3 space-y-3">
        {day.events.map((event, index) => {
          const next =
            day.events[index + 1] ??
            (index === day.events.length - 1 ? nextDayFirstEvent : undefined);
          const locked = event.locked ?? false;
          return (
            <li key={event.id} className="space-y-2">
              <button
                type="button"
                onClick={() => setSelectedEventId(event.id)}
                aria-expanded={selectedEventId === event.id}
                className={`grid w-full gap-2 rounded-md border p-4 text-left transition-colors sm:grid-cols-[130px_1fr_auto] sm:items-start ${
                  selectedEventId === event.id
                    ? "border-sage bg-sage-soft"
                    : "border-sand/80 bg-white hover:border-sage"
                }`}
              >
                <span className="text-sm font-semibold text-sage">
                  {formatPlanEventTimeRange(event)}
                </span>
                <span className="min-w-0">
                  <span className="block break-words text-base font-semibold text-charcoal">
                    {event.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-graphite">
                    <span>{eventTypeLabels[event.type]}</span>
                    <span>
                      {eventStatusLabels[event.status ?? "suggested"]}
                    </span>
                    {event.locationName ? <span>{event.locationName}</span> : null}
                    {event.note ? <span>{event.note}</span> : null}
                  </span>
                </span>
                <span className="inline-flex min-h-9 items-center gap-2 rounded-md bg-cream px-3 text-sm text-graphite sm:justify-self-end">
                  <Banknote aria-hidden="true" className="size-4 shrink-0" />
                  {formatMoneyAmount(event.costDraftCents)}｜
                  {costStatusLabels[event.costStatus]}
                </span>
                {locked ? (
                  <span className="inline-flex min-h-9 items-center gap-2 rounded-md bg-shell px-3 text-sm font-medium text-charcoal sm:col-start-3 sm:justify-self-end">
                    <Lock aria-hidden="true" className="size-4" />
                    已锁定
                  </span>
                ) : null}
              </button>
              {next ? (
                <p className="flex items-center gap-2 pl-4 text-sm text-graphite">
                  <ArrowDown aria-hidden="true" className="size-4 shrink-0 text-sage" />
                  {connectionLabel(event, next)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      {selectedEvent && draft ? (
        <section
          aria-labelledby="plan-event-edit-title"
          className="mt-4 rounded-md border border-sand/80 bg-cream p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id="plan-event-edit-title"
              className="flex min-w-0 items-center gap-2 text-lg font-semibold text-charcoal"
            >
              <PencilLine aria-hidden="true" className="size-5 shrink-0 text-sage" />
              编辑：{selectedEvent.title}
            </h3>
            {originalLocked ? (
              <span className="inline-flex min-h-9 items-center gap-2 rounded-md bg-white px-3 text-sm font-medium text-charcoal">
                <Lock aria-hidden="true" className="size-4" />
                已锁定
              </span>
            ) : null}
          </div>

          <form onSubmit={saveEdit} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-charcoal">
              开始时间
              <input
                type="time"
                value={draft.startTime}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  setDraft({ ...draft, startTime: event.target.value })
                }
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              />
            </label>
            <label className="block text-sm font-medium text-charcoal">
              时长（分钟）
              <input
                type="number"
                min={1}
                max={1440}
                step={1}
                value={draft.durationMinutes}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    durationMinutes: Number(event.target.value),
                  })
                }
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-white px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              />
            </label>
            <label className="block text-sm font-medium text-charcoal sm:col-span-2">
              备注
              <textarea
                value={draft.note}
                disabled={fieldsDisabled}
                maxLength={240}
                rows={2}
                onChange={(event) =>
                  setDraft({ ...draft, note: event.target.value })
                }
                className="mt-2 min-h-20 w-full rounded-md border border-sand bg-white px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none disabled:bg-graphite/10"
              />
            </label>

            <fieldset
              disabled={fieldsDisabled}
              className="rounded-md border border-sand bg-white p-3"
            >
              <legend className="px-1 text-sm font-medium text-charcoal">
                状态
              </legend>
              <div className="flex gap-4">
                {(["suggested", "confirmed"] as const).map((status) => (
                  <label
                    key={status}
                    className="inline-flex min-h-11 items-center gap-2 text-sm text-charcoal"
                  >
                    <input
                      type="radio"
                      name="event-status"
                      value={status}
                      checked={draft.status === status}
                      onChange={() => setDraft({ ...draft, status })}
                      className="size-5 text-sage"
                    />
                    {eventStatusLabels[status]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="inline-flex min-h-12 items-center gap-3 rounded-md border border-sand bg-white px-4 text-sm font-medium text-charcoal">
              <input
                type="checkbox"
                checked={draft.locked}
                disabled={!canEdit || isSaving}
                onChange={(event) =>
                  setDraft({ ...draft, locked: event.target.checked })
                }
                className="size-5 text-sage"
              />
              锁定这项安排
            </label>

            <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:flex-wrap">
              <button
                type="submit"
                disabled={!canEdit || isSaving}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70 sm:flex-none"
              >
                <Save aria-hidden="true" className="size-5" />
                {isSaving ? "正在保存..." : "保存修改"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(createDraft(selectedEvent));
                  setRemoveRequested(false);
                  setFeedback(null);
                }}
                disabled={isSaving}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-charcoal/20 bg-white px-5 py-3 text-base font-medium text-charcoal transition-colors hover:border-charcoal disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"
              >
                <X aria-hidden="true" className="size-5" />
                取消修改
              </button>
              <button
                type="button"
                onClick={() => setRemoveRequested(true)}
                disabled={!canEdit || isSaving || originalLocked || fixedEvent}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border border-clay px-5 py-3 text-base font-semibold text-clay transition-colors hover:bg-clay-soft disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                <Trash2 aria-hidden="true" className="size-5" />
                移除安排
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
              (originalLocked
                ? "已锁定的安排保持原时间、备注和状态；取消锁定后才能继续修改。"
                : canEdit
                  ? "编辑会生成新的计划版本，并继承当前版本的需求修订和确认快照。"
                  : "历史版本只读。")}
          </p>
        </section>
      ) : (
        <p className="mt-3 min-h-11 rounded-md bg-shell px-4 py-3 text-sm leading-6 text-graphite">
          {canEdit ? "尚未选择日程。" : "历史版本只读。"}
        </p>
      )}

      {!canEdit ? (
        <p className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-clay-soft px-3 text-sm text-clay">
          <CircleAlert aria-hidden="true" className="size-4" />
          历史版本不能编辑
        </p>
      ) : null}
      {originalLocked && selectedEvent ? (
        <p className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-shell px-3 text-sm text-charcoal">
          <LockOpen aria-hidden="true" className="size-4" />
          取消锁定会创建新版本，但不会同时改动时间、状态或备注
        </p>
      ) : null}
    </div>
  );
}
