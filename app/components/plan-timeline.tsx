"use client";
import { businessFetch } from "@/lib/business-fetch";

import {
  ArrowDown,
  Banknote,
  BedDouble,
  BriefcaseBusiness,
  CircleAlert,
  BookOpenCheck,
  Leaf,
  Lock,
  LockOpen,
  MapPin,
  PencilLine,
  Save,
  Sofa,
  TrainFront,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatPlanEventTimeRange,
  type PlanOverviewDay,
} from "@/lib/plan-overview";
import { costCertaintyLabels, eventCostSummary, formatMoneyRange } from "@/lib/budget";
import {
  planEventEnd,
  planEventStart,
  planEventDurationSeconds,
  sortPlanEvents,
  type PlanEvent,
  type PlanEventStatus,
} from "@/lib/plan";
import type { PlanVersionClient } from "./plan-overview";
import type { EvidenceFactClient, EvidenceField } from "@/lib/evidence";
import { effectiveEvidenceStatus, evidenceFieldLabels, evidenceStatusLabels, summarizeEventEvidence } from "@/lib/evidence";
import { numberPlanEvents } from "@/lib/map-link";
import { RouteSummary, routeModeLabels } from "./route-summary";
import { EvidenceDrawer } from "./evidence-drawer";
import type { AdvisoryItem } from "@/lib/advisories";
import { AttractionTimelineCard } from "./attraction-card";
import { RestaurantTimelineCard } from "./restaurant-card";
import type { MapLinkTarget } from "./plan-map";
import { useVersionedDraft } from "./use-versioned-draft";
import { predepartureBriefingIds, timelinePresentation } from "@/lib/timeline-presentation";
import styles from "./plan-timeline.module.css";

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
      Math.round(planEventDurationSeconds(event) / 60),
    ),
    note: event.note ?? "",
    locked: event.locked ?? false,
    status: event.status ?? "suggested",
  };
}

const draftFieldLabels: Record<keyof Draft, string> = {
  startTime: "开始时间", durationMinutes: "时长", note: "备注", locked: "锁定状态", status: "确认状态",
};
const equalDraftField = (field: keyof Draft, left: Draft[keyof Draft], right: Draft[keyof Draft]) =>
  field === "note" ? String(left).trim() === String(right).trim() : Object.is(left, right);
const incomingDraftValue = (field: keyof Draft, value: Draft[keyof Draft]) => {
  if (field === "status") return eventStatusLabels[value as PlanEventStatus];
  if (field === "locked") return value ? "已锁定" : "未锁定";
  return String(value) || "（空）";
};

function formatGap(minutes: number) {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

function connectionLabel(current: PlanEvent, next: PlanEvent) {
  if (current.ticketTimingPending || next.ticketTimingPending) {
    return "票面时刻待补 / 冲突，衔接待重算";
  }
  const gapMinutes = Math.round(
    (planEventStart(next).getTime() - planEventEnd(current).getTime()) /
      60_000,
  );
  if (gapMinutes < 0) {
    return "时段冲突，请修改";
  }
  return gapMinutes === 0 ? null : `预留 ${formatGap(gapMinutes)}`;
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
  selectedEventId,
  highlightedEventId,
  onEventHover,
  onEventSelect,
  advisories = [],
  onAdvisories,
}: {
  tripId: string;
  plan: PlanVersionClient;
  day: PlanOverviewDay;
  onSaved: (plan: PlanVersionClient) => void;
  selectedEventId: string | null;
  highlightedEventId?: string | null;
  onEventHover?: (eventId: string | null) => void;
  onEventSelect: (eventId: string, target: MapLinkTarget, dayNumber: number) => void;
  advisories?: AdvisoryItem[];
  onAdvisories?: () => void;
}) {
  const selectedEvent = plan.events.find((event) => event.id === selectedEventId);
  const sourceDraft = useMemo(() => selectedEvent ? createDraft(selectedEvent) : null, [selectedEvent]);
  const { draft, setDraft, resetDraft, acknowledgeSaved, conflicts } = useVersionedDraft({
    scope: tripId, version: plan.id, itemId: selectedEventId, source: sourceDraft, equal: equalDraftField,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [removeRequested, setRemoveRequested] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [evidenceFacts, setEvidenceFacts] = useState<EvidenceFactClient[]>(
    plan.evidenceFacts ?? [],
  );
  const [drawerField, setDrawerField] = useState<EvidenceField | null>(null);
  const scope = `${tripId}/${plan.id}`;
  const activeScope = useRef<string | null>(scope);
  useEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);
  const currentFacts = evidenceFacts.filter((fact) => fact.planVersionId === plan.id)
    .map((fact) => ({ ...fact, effectiveStatus: effectiveEvidenceStatus(fact) }));
  const numberedEvents = useMemo(() => numberPlanEvents(day.events), [day.events]);
  const briefingIds = useMemo(() => predepartureBriefingIds(day.events), [day.events]);

  const nextDayFirstEvent = useMemo(() => {
    const nextDayEvents = plan.events.filter(
      (event) => event.dayNumber === day.dayNumber + 1,
    );
    return sortPlanEvents(nextDayEvents)[0];
  }, [plan.events, day.dayNumber]);

  useEffect(() => {
    setRemoveRequested(false);
  }, [plan.id, selectedEventId]);

  useEffect(() => {
    setEvidenceFacts(plan.evidenceFacts ?? []);
  }, [plan.id, plan.evidenceFacts]);

  const canEdit = plan.isCurrent;
  const originalLocked = selectedEvent?.locked ?? false;
  const ticketManaged = Boolean(selectedEvent?.ticketManaged);
  const fixedEvent =
    selectedEvent?.type === "departure_transport" ||
    selectedEvent?.type === "return_transport";
  const fieldsDisabled = !canEdit || isSaving || originalLocked || ticketManaged;
  const selectedFact = (field: EvidenceField) =>
    currentFacts.find(
      (fact) => fact.targetId === selectedEvent?.id && fact.field === field,
    ) ?? null;

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || !selectedEvent || !draft || ticketManaged) {
      return;
    }

    setIsSaving(true);
    setFeedback({ tone: "info", message: "正在保存日程修改..." });
    // Another editor may have locked this event while a note/time draft was
    // pending. Unlock using the server fields first and keep that local draft.
    const unlocking = originalLocked && !draft.locked;
    const submitted = unlocking && sourceDraft ? { ...sourceDraft, locked: false } : draft;
    try {
      const response = await businessFetch(
        `/api/trips/${tripId}/plans/${plan.versionNumber}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "event",
            eventId: selectedEvent.id,
            startTime: submitted.startTime,
            durationMinutes: submitted.durationMinutes,
            timeEdit: submitted.startTime !== sourceDraft?.startTime || submitted.durationMinutes !== sourceDraft?.durationMinutes ? "start_duration" : "preserve",
            note: submitted.note.trim() ? submitted.note : null,
            locked: submitted.locked,
            status: submitted.status,
            remove: removeRequested,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { plan: PlanVersionClient };
      const savedEvent = payload.plan.events.find((item) => item.id === selectedEvent.id);
      if (savedEvent && !unlocking) acknowledgeSaved(savedEvent.id, createDraft(savedEvent), payload.plan.id);
      onSaved(payload.plan);
      setFeedback({
        tone: "success",
        message: unlocking
          ? `计划版本 ${payload.plan.versionNumber} 已保存并取消锁定；待保存的其他输入仍保留，请核对后继续保存。`
          : `计划版本 ${payload.plan.versionNumber} 已保存。`,
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
      <ol className={styles.timeline} aria-label="当日行程时间轴">
        {numberedEvents.map(({ event, visitLabel }, index) => {
          const next =
            numberedEvents[index + 1]?.event ??
            (index === numberedEvents.length - 1 ? nextDayFirstEvent : undefined);
          const locked = event.locked ?? false;
          const eventFacts = currentFacts.filter(
            (fact) => fact.targetId === event.id,
          );
          const evidence = summarizeEventEvidence(eventFacts);
          const presentation = timelinePresentation(event);
          // Never fold a day's transport or sightseeing into a transition row.
          const compact = briefingIds.has(event.id);
          const CategoryIcon = presentation.category === "sight" ? Leaf
            : presentation.category === "food" ? Utensils
            : presentation.category === "stay" ? BedDouble
            : presentation.category === "transit" ? TrainFront
            : presentation.category === "rest" ? Sofa : BriefcaseBusiness;
          const openingConflict = advisories.some((item) => item.eventIds.includes(event.id) && item.category === "opening_hours" && item.severity === "action");
          const status = openingConflict ? "conflict" : evidence.status;
          const statusLabel = openingConflict ? "开放冲突 · 需调整" : status === "conflict" ? "需调整" : status === "stale" ? "待复核" : status === "verified" ? "已核实" : "待核实";
          const eventAdvisories = advisories.filter((item) => item.eventIds.includes(event.id) && (!item.acknowledged || item.severity === "action"));
          const eventCost = eventCostSummary(event.id, plan.costs, plan.requestSnapshot);
          const route = next
            ? plan.routeLegs?.find((item) => item.fromEventId === event.id && item.toEventId === next.id)
            : undefined;
          const routeReference = route?.manualReference;
          const routeSeconds = routeReference
            ? routeReference.durationMinutes == null ? null : routeReference.durationMinutes * 60
            : route?.durationSeconds;
          const routeUnavailable = route?.status === "unavailable" || routeReference?.availability === "no_service";
          const connection = next ? connectionLabel(event, next) : null;
          return (
            <li key={event.id} id={`timeline-event-${event.id}`} data-timeline-level={compact ? "briefing" : "experience"}>
              <div className={`${styles.eventCard} ${compact ? styles.briefingCard : ""}`} data-selected={selectedEventId === event.id} data-highlighted={highlightedEventId === event.id}
                onMouseEnter={() => onEventHover?.(event.id)} onMouseLeave={() => onEventHover?.(null)}
                onFocus={() => onEventHover?.(event.id)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onEventHover?.(null); }}>
                <button
                  type="button"
                  onClick={() => onEventSelect(event.id, "timeline", day.dayNumber)}
                  aria-expanded={selectedEventId === event.id}
                  aria-label={`第 ${index + 1} 项：${event.title}`}
                  className={styles.eventMain}
                  title={compact ? `${event.title}${event.note ? ` · ${event.note}` : ""}` : undefined}
                >
                  {compact ? <>
                    <span className={styles.visitBadge} data-testid="timeline-visit-number">{visitLabel}</span>
                    <span className={styles.briefingBody}><span className={styles.briefingLabel}>行前提示 · {event.startTime}</span><strong>{event.title}</strong>{event.note ? <span>{event.note}</span> : null}</span>
                  </> : <>
                    <span className={styles.timeRail}>
                      <span className={styles.visitBadge} data-testid="timeline-visit-number">{visitLabel}</span>
                      <span className={styles.timeRange}>{event.ticketTimingPending ? "票面时刻待补 / 冲突" : formatPlanEventTimeRange(event)}</span>
                      <span className={styles.categoryBadge} data-category={presentation.category}><CategoryIcon aria-hidden="true" className="size-3.5" />{presentation.label}</span>
                    </span>
                    <span className={styles.eventBody}>
                      <span className={styles.titleRow}>
                        <span className={styles.eventTitle}>{event.title}</span>
                        <span className={styles.statusBadge} data-status={status} title={`${eventStatusLabels[event.status ?? "suggested"]} · ${evidence.label}`}>{statusLabel}</span>
                      </span>
                      {event.locationName && event.locationName !== event.title ? <span className={styles.eventLocation}>{event.locationName}</span> : null}
                      {event.note ? <span className={styles.eventNote}>{event.note}</span> : null}
                      <span className={styles.costRow}>
                        <span className={styles.cost}><Banknote aria-hidden="true" className="size-3.5" />{formatMoneyRange(eventCost?.minCents ?? null, eventCost?.maxCents ?? null)}｜{eventCost ? costCertaintyLabels[eventCost.certainty] : "待确认"}</span>
                        {locked ? <span className={styles.locked}><Lock aria-hidden="true" className="size-3" />已锁定</span> : null}
                      </span>
                    </span>
                  </>}
                </button>
                {eventAdvisories.map((item) => <button key={item.id} type="button" onClick={onAdvisories} className={styles.advisory}><CircleAlert aria-hidden="true" className="size-3.5 shrink-0" /><span>行程提醒：{item.title}{item.acknowledged ? "（已知，限制仍适用）" : ""}</span></button>)}
                {!compact && event.type === "activity" ? <AttractionTimelineCard key={`${scope}/${event.id}`} tripId={tripId} plan={plan} event={event} visitLabel={visitLabel} onMap={() => onEventSelect(event.id, "map", day.dayNumber)} onSaved={(savedPlan) => { if (activeScope.current === scope && plan.isCurrent) onSaved(savedPlan); }} /> : null}
                {!compact && event.type === "meal" ? <RestaurantTimelineCard key={`${scope}/${event.id}`} tripId={tripId} plan={plan} event={event} visitLabel={visitLabel} onMap={() => onEventSelect(event.id, "map", day.dayNumber)} onSaved={(savedPlan) => { if (activeScope.current === scope && plan.isCurrent) onSaved(savedPlan); }} /> : null}
                {!compact && event.type !== "activity" && event.type !== "meal" ? <div className={styles.eventFooter}>
                  {event.type === "departure_transport" || event.type === "return_transport" ? <button type="button" onClick={() => onEventSelect(event.id, "transport", event.dayNumber)} className={styles.compactLink} aria-label="查看交通票面" title="查看交通票面"><TrainFront aria-hidden="true" className="size-3.5" /></button> : null}
                  <button type="button" onClick={() => onEventSelect(event.id, "map", day.dayNumber)} aria-label={`定位地图：${visitLabel}${event.title}`} title="地图与详情" className={compact ? styles.compactLink : styles.mapLink}><MapPin aria-hidden="true" className="size-3.5" />{compact ? null : "地图与详情"}</button>
                </div> : null}
              </div>
              {route ? <details className={styles.routeConnection}>
                <summary><ArrowDown aria-hidden="true" className="size-3 shrink-0" />{routeModeLabels[route.mode]}{routeUnavailable ? " · 暂无可用路线" : routeSeconds ? ` · 约 ${formatGap(Math.max(1, Math.round(routeSeconds / 60)))}` : ""}{routeReference?.requiresReconfirmation ? " · 原参考待复核" : ""}{route.conflict ? " · 衔接需调整" : ""}<span>查看路线</span></summary>
                <RouteSummary route={route} compact />
              </details> : connection ? <p className={styles.connection} data-conflict={Boolean(event.ticketTimingPending || next?.ticketTimingPending || connection.includes("冲突"))}><ArrowDown aria-hidden="true" className="size-3 shrink-0" />{connection}</p> : null}
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

          {ticketManaged ? <div className="mt-3 rounded-md bg-sage-soft p-3 text-sm leading-6 text-charcoal"><p>当前交通由有效票面固定，请在门到门交通中记录已办妥的退票或替换事实。</p><button type="button" onClick={() => onEventSelect(selectedEvent.id, "transport", selectedEvent.dayNumber)} className="mt-2 min-h-11 rounded-md border border-sage bg-white px-3 font-semibold text-sage">管理这项交通票面</button></div> : null}

          <section
            aria-labelledby="event-evidence-title"
            className="mt-4 rounded-md border border-sand/80 bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="event-evidence-title"
                className="flex min-w-0 items-center gap-2 text-base font-semibold text-charcoal"
              >
                <BookOpenCheck aria-hidden="true" className="size-5 shrink-0 text-sage" />
                来源与可靠性
              </h3>
              <p className="text-sm text-graphite">
                安排：
                {selectedEvent.status === "confirmed" ? "用户已确认" : "AI建议"}
                ｜费用：
                {plan.costs.find((cost) => cost.linkedEventId === selectedEvent.id)
                  ?.certainty === "user_confirmed"
                  ? "用户已确认"
                  : plan.costs.find((cost) => cost.linkedEventId === selectedEvent.id)
                      ?.certainty === "estimated"
                    ? "AI估算"
                    : "待确认"}
              </p>
            </div>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {(Object.keys(evidenceFieldLabels) as EvidenceField[]).map((field) => {
                const fact = currentFacts.find(
                  (item) => item.targetId === selectedEvent.id && item.field === field,
                );
                return (
                  <li key={field}>
                    <button
                      type="button"
                      onClick={() => setDrawerField(field)}
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-md border border-sand bg-cream px-4 py-3 text-left text-sm text-charcoal transition-colors hover:border-sage"
                    >
                      <span className="font-medium">{evidenceFieldLabels[field]}</span>
                      <span
                        className={`inline-flex min-h-9 items-center rounded-md px-2 text-sm font-medium ${
                          fact?.effectiveStatus === "verified"
                            ? "bg-sage-soft text-sage"
                            : fact?.effectiveStatus === "conflict" ||
                                fact?.effectiveStatus === "stale"
                              ? "bg-clay-soft text-clay"
                              : "bg-shell text-graphite"
                        }`}
                      >
                        {fact
                          ? evidenceStatusLabels[fact.effectiveStatus]
                          : "建议确认"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {conflicts.length > 0 ? <div role="alert" className="mt-4 rounded-md bg-clay-soft px-4 py-3 text-sm leading-6 text-clay">
            <p>新版本也修改了{conflicts.map((field) => draftFieldLabels[field]).join("、")}。你的未保存输入已保留，请核对后保存；选择“取消修改”可采用新版本的值。</p>
            <ul className="mt-2">{conflicts.map((field) => <li key={field}>新版{draftFieldLabels[field]}：{sourceDraft ? incomingDraftValue(field, sourceDraft[field]) : "（未知）"}</li>)}</ul>
          </div> : null}
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
                maxLength={6000}
                rows={6}
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
                disabled={!canEdit || isSaving || ticketManaged}
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
                disabled={!canEdit || isSaving || ticketManaged}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70 sm:flex-none"
              >
                <Save aria-hidden="true" className="size-5" />
                {isSaving ? "正在保存..." : "保存修改"}
              </button>
              <button
                type="button"
                onClick={() => {
                  resetDraft();
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
              (ticketManaged
                ? "有效票面不可在普通日程编辑中解除，请使用交通票面入口。"
                : originalLocked
                ? "已锁定的安排保持原时间、备注和状态；取消锁定后才能继续修改。"
                : canEdit
                  ? "编辑会生成新的计划版本，并继承当前版本的需求修订和确认快照。"
                  : "历史版本只读。")}
          </p>
        </section>
      ) : null}

      {!canEdit ? (
        <p className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-clay-soft px-3 text-sm text-clay">
          <CircleAlert aria-hidden="true" className="size-4" />
          历史版本不能编辑
        </p>
      ) : null}
      {originalLocked && selectedEvent && !ticketManaged ? (
        <p className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-md bg-shell px-3 text-sm text-charcoal">
          <LockOpen aria-hidden="true" className="size-4" />
          取消锁定会创建新版本，但不会同时改动时间、状态或备注
        </p>
      ) : null}
      {drawerField && selectedEvent ? (
        <EvidenceDrawer
          key={`${scope}/${selectedEvent.id}/${drawerField}`}
          tripId={tripId}
          plan={plan}
          event={selectedEvent}
          field={drawerField}
          fact={selectedFact(drawerField)}
          onClose={() => setDrawerField(null)}
          onRefreshState={(status) => {
            if (activeScope.current !== scope || !plan.isCurrent) return;
            setEvidenceFacts((facts) => {
              const existing = facts.find((fact) => fact.planVersionId === plan.id && fact.targetId === selectedEvent.id && fact.field === drawerField);
              const pending: EvidenceFactClient = existing ?? {
                id: `pending-${selectedEvent.id}-${drawerField}`, planVersionId: plan.id,
                targetType: "event", targetId: selectedEvent.id, field: drawerField,
                status: "unverified", effectiveStatus: "stale", sourceTitle: "", sourceUrl: "",
                sourcePublisher: "", sourcePublishedAt: null, sourceDateStatus: "not_read",
                extractedValue: "", searchProvider: "", searchQuery: "", retrievedAt: new Date().toISOString(),
                applicableFrom: null, applicableUntil: null, lastRefreshAt: null, lastRefreshStatus: null,
                lastRefreshError: null, contentQuote: "", conflictReason: null,
              };
              return [...facts.filter((fact) => fact !== existing), { ...pending, lastRefreshStatus: status }];
            });
          }}
          onSaved={(fact) => {
            window.dispatchEvent(new Event("serendipity:advisories-changed"));
            if (activeScope.current !== scope || fact.planVersionId !== plan.id ||
              fact.targetId !== selectedEvent.id || fact.field !== drawerField || !plan.isCurrent) return;
            setEvidenceFacts((facts) => [
              ...facts.filter(
                (item) =>
                  !(
                    item.targetId === fact.targetId &&
                    item.field === fact.field
                  ),
              ),
              fact,
            ]);
          }}
        />
      ) : null}
    </div>
  );
}
