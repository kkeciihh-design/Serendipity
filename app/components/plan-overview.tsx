"use client";
import { businessFetch } from "@/lib/business-fetch";
import { createTripWithPlan, generatePlanWithRetry } from "@/lib/trip-auto-planning";

import {
  ChevronDown,
  Download,
  ListChecks,
  PencilLine,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { PlanMap, type MapLinkTarget } from "./plan-map";
import { TransportOverview } from "./transport-overview";
import { RedlinePanel } from "./redline-panel";
import { AccommodationPanel } from "./accommodation-panel";
import { ChecklistPanel } from "./checklist-panel";
import { ReplanPanel } from "./replan-panel";
import { TripBottomNav } from "./trip-bottom-nav";
import { AdvisoryPanel, useAdvisories } from "./advisory-panel";
import { PlanCompanion } from "./plan-companion";
import type { Place } from "@/lib/places";
import type { RouteLeg } from "@/lib/routes";
import type { Ticket } from "@/lib/tickets";
import type {
  PlanEvent,
  PlanPendingItem,
  PlanValidationResults,
} from "@/lib/plan";
import type { EvidenceFactClient } from "@/lib/evidence";
import type { RequestSnapshot } from "@/lib/trip-request";
import styles from "./plan-workspace.module.css";

export type PlanVersionClient = {
  id: string;
  tripId: string;
  versionNumber: number;
  requestRevision: number;
  requestSnapshot: RequestSnapshot;
  events: PlanEvent[];
  costs: PlanCostItem[];
  places?: Place[];
  routeLegs?: RouteLeg[];
  tickets?: Ticket[];
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

export function PlanOverview({
  tripId,
  tripTitle,
  plans,
  selectedVersionNumber,
  requestState,
  onOpenRequirements,
  onPlanGenerated,
  originalRequest,
  planningNotice,
}: {
  tripId: string;
  tripTitle: string;
  plans: PlanVersionClient[];
  selectedVersionNumber: number | null;
  requestState: PlanRequestState;
  onOpenRequirements?: () => void;
  onPlanGenerated?: () => void;
  originalRequest: string;
  planningNotice?: string | null;
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
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [selectedDayNumber, setSelectedDayNumber] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [pendingTimelineScrollEventId, setPendingTimelineScrollEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "timeline" | "transport" | "budget" | "map" | "accommodation" | "checklist" | "advisories" | "replan" | "more"
  >("timeline");
  const [hasOpenedMap, setHasOpenedMap] = useState(false);
  const [hasOpenedBudget, setHasOpenedBudget] = useState(false);
  const [hasOpenedChecklist, setHasOpenedChecklist] = useState(false);
  const [checklistFocusId, setChecklistFocusId] = useState<string | null>(null);
  const [transportDirection, setTransportDirection] = useState<"departure" | "return">("departure");
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const generatedCallbackRef = useRef(onPlanGenerated);
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const menus = () => workspaceRef.current?.querySelectorAll<HTMLDetailsElement>("details[data-toolbar-menu]") ?? [];
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      for (const menu of menus()) {
        if (!menu.contains(event.target) || event.target.closest("a,button")) menu.open = false;
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const menu of menus()) {
        if (menu.open && menu.contains(document.activeElement)) menu.querySelector("summary")?.focus();
        menu.open = false;
      }
    };
    document.addEventListener("click", click);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    workspaceRef.current?.querySelectorAll<HTMLDetailsElement>("details[data-toolbar-menu]").forEach((menu) => { menu.open = false; });
  }, [activeTab, selectedVersionNumber]);

  useEffect(() => {
    if (!feedback || feedback.tone === "error" || isGenerating) return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback, isGenerating]);

  useEffect(() => {
    generatedCallbackRef.current = onPlanGenerated;
  }, [onPlanGenerated]);

  useEffect(() => {
    setPreviewPlan(selectedPlan);
  }, [selectedPlan]);

  useEffect(() => {
    if (activeTab === "map") setHasOpenedMap(true);
    if (activeTab === "budget") setHasOpenedBudget(true);
    if (activeTab === "checklist") setHasOpenedChecklist(true);
  }, [activeTab]);

  useEffect(() => {
    const view = new URL(window.location.href).searchParams.get("view");
    if (view === "timeline" || view === "map" || view === "budget" || view === "more" || view === "transport") {
      setActiveTab(view);
      document.getElementById("plan-views")?.scrollIntoView({ block: "start" });
    }
    if (new URL(window.location.href).searchParams.get("view") === "replan") {
      setActiveTab("replan");
      document.getElementById("plan-views")?.scrollIntoView({ block: "start" });
    }
    if (new URL(window.location.href).searchParams.get("view") === "advisories") {
      setActiveTab("advisories");
      document.getElementById("plan-views")?.scrollIntoView({ block: "start" });
    }
    if (new URL(window.location.href).searchParams.get("view") === "checklist") {
      setActiveTab("checklist");
      document.getElementById("plan-views")?.scrollIntoView({ block: "start" });
    }
  }, []);

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
  const advisoryData = useAdvisories(tripId, displayPlan);
  const openAdvisories = () => { setActiveTab("advisories"); document.getElementById("plan-views")?.scrollIntoView({ block: "start" }); };
  const canGenerate =
    !isGenerating && (requestState.confirmed || !displayPlan) && !requestState.hasUnsavedEdits;
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
      if (!requestState.confirmed) {
        await createTripWithPlan({ originalRequest, existingTripId: tripId,
          fetcher: businessFetch, signal: controller.signal });
        generatedCallbackRef.current?.();
        router.replace(`/trips/${tripId}`, { scroll: false });
        router.refresh();
        setFeedback({ tone: "success", message: "行程已生成，旅程准备就绪。" });
        return;
      }
      const payload = await generatePlanWithRetry({ tripId,
        expectedRequestRevision: requestState.requestRevision,
        expectedPlanVersion: currentPlan?.versionNumber ?? null,
        fetcher: businessFetch, signal: controller.signal });
      handlePlanSaved(payload.plan, true);
      // Read the latest callback so edits typed during generation remain open.
      generatedCallbackRef.current?.();
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
    } catch (error) {
      if (controller.signal.aborted) {
        setFeedback({
          tone: "info",
          message: "已取消等待生成结果。未收到响应不能确认是否已保存，请重新读取当前计划核对。",
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

  const openRequirements = () => {
    onOpenRequirements?.();
    window.requestAnimationFrame(() => {
      document.getElementById("request-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handlePlanSaved = (savedPlan: PlanVersionClient, generated = false) => {
    setPreviewPlan(savedPlan);
    // A URL pinned to the old current version must not select that now-historic
    // version again after a successful save. Navigation fetches the new current
    // version; the unpinned route only needs its server data refreshed.
    if (selectedVersionNumber !== null || generated) {
      const url = new URL(window.location.href);
      url.searchParams.delete("planVersion");
      if (generated) {
        url.searchParams.delete("editRequirements");
        url.searchParams.delete("planningNotice");
      }
      const destination = `${url.pathname}${url.search}${url.hash}`;
      if (destination !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        router.replace(destination, { scroll: false });
      } else {
        router.refresh();
      }
    } else {
      router.refresh();
    }
  };

  const handleEventSelect = useCallback((
    eventId: string,
    target: MapLinkTarget,
    dayNumber: number,
  ) => {
    setSelectedEventId(eventId);
    setSelectedDayNumber(dayNumber);
    setActiveTab(target);
    if (target === "transport") {
      const event = displayPlan?.events.find((item) => item.id === eventId);
      setTransportDirection(event?.type === "return_transport" ? "return" : "departure");
    }
    setPendingTimelineScrollEventId(target === "timeline" ? eventId : null);
  }, [displayPlan]);

  const handleCompanionSelect = useCallback((id: string) => {
    const event = displayPlan?.events.find((item) => item.id === id);
    if (event) handleEventSelect(id, "timeline", event.dayNumber);
  }, [displayPlan, handleEventSelect]);

  const handleDayChange = useCallback((dayNumber: number) => {
    setHoveredEventId(null);
    setSelectedDayNumber(dayNumber);
    setSelectedEventId((current) => {
      const event = displayPlan?.events.find((item) => item.id === current);
      return event?.dayNumber === dayNumber ? current : null;
    });
  }, [displayPlan]);

  useEffect(() => {
    if (
      selectedEventId &&
      (!displayPlan || !displayPlan.events.some((event) => event.id === selectedEventId))
    ) {
      setSelectedEventId(null);
      setPendingTimelineScrollEventId(null);
    }
  }, [displayPlan, selectedEventId]);

  useEffect(() => {
    if (!pendingTimelineScrollEventId || activeTab !== "timeline") return;
    const frame = window.requestAnimationFrame(() => {
      document
        .getElementById(`timeline-event-${pendingTimelineScrollEventId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPendingTimelineScrollEventId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, pendingTimelineScrollEventId]);

  return (
    <section
      ref={workspaceRef}
      aria-label="行程总览"
      className={styles.workspace}
    >
      {displayPlan && requiresUpdate ? (
        <p className="mt-4 rounded-md bg-clay-soft px-4 py-3 text-base leading-7 text-clay">
          最新需求已经变化；本页仍完整展示这个计划自己的确认快照。请回到需求确认区核对、确认新修订，再生成新计划版本。
        </p>
      ) : null}

      {feedback && displayPlan ? <div
        role="status"
        aria-live="polite"
        className={`${styles.feedback} ${
          feedback?.tone === "error"
            ? "bg-clay-soft text-clay"
            : feedback?.tone === "success"
              ? "bg-sage-soft text-sage"
              : "bg-shell text-graphite"
        }`}
      >
        {feedback.message}
      </div> : null}

      {displayPlan ? (
        <>
          <RedlinePanel key={displayPlan.id} tripId={tripId} plan={displayPlan} onSaved={handlePlanSaved} onlyRisks={activeTab !== "transport"} />
          {displayPlan.validationResults.errors.length > 0 ? (
            <div className="mt-4 rounded-md border border-clay bg-clay-soft p-4">
              <h3 className="text-base font-semibold text-clay">
                当前存在硬冲突或待补数据
              </h3>
              <ul className="mt-2 space-y-1 text-sm leading-6 text-charcoal">
                {displayPlan.validationResults.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={styles.overviewToolbar}>
            <div className={styles.versionTools}>
              <details name="trip-plan-actions" data-toolbar-menu className={styles.versionMenu}>
                <summary data-testid="plan-version-select" aria-label={`版本 V${displayPlan.versionNumber}`}>版本 V{displayPlan.versionNumber}<ChevronDown size={14} aria-hidden="true" /></summary>
                <div className={styles.versionOptions}>{(plans.some((plan) => plan.versionNumber === displayPlan.versionNumber) ? plans : [displayPlan, ...plans]).map((plan) => <a key={plan.id} href={`/trips/${tripId}?planVersion=${plan.versionNumber}`} aria-current={plan.versionNumber === displayPlan.versionNumber ? "true" : undefined}>V{plan.versionNumber}<span>{plan.isCurrent ? "当前版本" : "历史版本"}</span></a>)}</div>
              </details>
              {(!displayPlan.isCurrent || requiresUpdate) ? <span className={styles.statusNote}>{statusLabel}</span> : null}
              {requestState.hasUnsavedEdits ? <span className={styles.statusNote}>需求修改未保存</span> : null}
            </div>
            <button type="button" className={styles.snapshotToggle} aria-expanded={snapshotOpen} aria-controls="plan-request-snapshot" onClick={() => setSnapshotOpen(!snapshotOpen)}>
              查看本版需求快照<ChevronDown aria-hidden="true" className="size-4" />
            </button>
            <div className={styles.toolbar}>
              {displayPlan.isCurrent && <Link href={`/trips/${tripId}/execute`} className={styles.primaryAction}>进入旅行执行模式</Link>}
              <details name="trip-plan-actions" data-toolbar-menu className={styles.actionMenu}>
                <summary><SlidersHorizontal aria-hidden="true" className="size-4" />调整 / 重排行程<ChevronDown aria-hidden="true" className="size-4" /></summary>
                <div className={styles.actionMenuPanel}>
                  <button type="button" onClick={() => { setActiveTab("replan"); document.getElementById("plan-views")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={styles.menuItem}>AI 重新规划</button>
                  <button type="button" onClick={generatePlan} disabled={!canGenerate} className={styles.menuItem}><Sparkles aria-hidden="true" className="size-5" />{isGenerating ? `正在生成... ${elapsedSeconds} 秒` : `生成新计划版本 V${(currentPlan?.versionNumber ?? 0) + 1}`}</button>
                  <a href="#request-workspace" onClick={(event) => { event.preventDefault(); openRequirements(); }} className={styles.menuItem}><PencilLine aria-hidden="true" className="size-5" />修改需求</a>
                </div>
              </details>
              {displayPlan.isCurrent ? <details name="trip-plan-actions" data-toolbar-menu className={styles.actionMenu}>
                <summary><Download aria-hidden="true" className="size-4" />导出随身资料<ChevronDown aria-hidden="true" className="size-4" /></summary>
                <div className={styles.actionMenuPanel}>
                  <Link href={`/trips/${tripId}/mobile`} className={styles.menuItem}>手机一页版 · 离线保存</Link>
                  <Link href={`/trips/${tripId}/text`} className={styles.menuItem}>文字导出 · 复制与下载</Link>
                  <Link href={`/trips/${tripId}/pdf`} className={styles.menuItem}>PDF旅行手册 · 保存与打印</Link>
                  <Link href={`/trips/${tripId}/image`} className={styles.menuItem}>旅行长图 · 保存图片</Link>
                </div>
              </details> : null}
              {isGenerating ? (
                <button type="button" onClick={cancelGeneration} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-clay px-5 py-3 text-base font-semibold text-clay transition-colors hover:bg-clay-soft"><XCircle aria-hidden="true" className="size-5" />取消生成</button>
              ) : null}
            </div>

          </div>

          <div id="plan-request-snapshot" className={styles.snapshotPanel} hidden={!snapshotOpen}>
              <dl className="grid gap-x-5 gap-y-4 rounded-2xl border border-[#18221D]/10 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-sm text-graphite">旅行标题</dt>
                  <dd className="mt-1 break-words text-base font-semibold text-charcoal">{tripTitle}</dd>
                </div>
                <div>
                  <dt className="text-sm text-graphite">目的地</dt>
                  <dd className="mt-1 break-words text-base font-semibold text-charcoal">{displayPlan.requestSnapshot.destination ?? "未确认"}</dd>
                </div>
                <div>
                  <dt className="text-sm text-graphite">日期</dt>
                  <dd className="mt-1 text-base font-semibold text-charcoal">{formatRequestDateRange(displayPlan.requestSnapshot)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-graphite">人数</dt>
                  <dd className="mt-1 text-base font-semibold text-charcoal">{formatTravelerCount(displayPlan.requestSnapshot)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-graphite">节奏</dt>
                  <dd className="mt-1 text-base font-semibold text-charcoal">{formatPlanPace(displayPlan.requestSnapshot)}</dd>
                </div>
                <div>
                  <dt className="text-sm text-graphite">费用</dt>
                  <dd className="mt-1 text-base font-semibold text-charcoal">{budgetSummary ? `${formatBudgetTarget(displayPlan.requestSnapshot)}｜预计 ${formatMoneyRange(budgetSummary.totalMinCents, budgetSummary.totalMaxCents)}｜${overspendStatusLabels[budgetSummary.overspendStatus]}` : "费用待核算"}</dd>
                </div>
              </dl>

          </div>

          <div id="plan-views" className="mt-5 scroll-mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="计划视图"
                className={styles.viewTabs}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "timeline"}
                  onClick={() => setActiveTab("timeline")}
                  className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${
                    activeTab === "timeline"
                      ? "bg-[#1B362A] text-white shadow-sm"
                      : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"
                  }`}
                >
                  每日时间轴
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "budget"}
                  onClick={() => setActiveTab("budget")}
                  className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${
                    activeTab === "budget"
                      ? "bg-[#1B362A] text-white shadow-sm"
                      : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"
                  }`}
                >
                  预算
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "transport"}
                  onClick={() => setActiveTab("transport")}
                  className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${
                    activeTab === "transport"
                      ? "bg-[#1B362A] text-white shadow-sm"
                      : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"
                  }`}
                >
                  门到门交通
                </button>
                <button type="button" role="tab" aria-selected={activeTab === "accommodation"} onClick={() => setActiveTab("accommodation")}
                  className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${activeTab === "accommodation" ? "bg-[#1B362A] text-white shadow-sm" : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"}`}>住宿推荐</button>
                <button type="button" role="tab" aria-selected={activeTab === "map"} onClick={() => setActiveTab("map")}
                  className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${activeTab === "map" ? "bg-[#1B362A] text-white shadow-sm" : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"}`}>地图</button>
                <button type="button" role="tab" aria-selected={activeTab === "checklist"} onClick={() => setActiveTab("checklist")}
                  className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${activeTab === "checklist" ? "bg-[#1B362A] text-white shadow-sm" : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"}`}>出发前清单</button>
                <button type="button" role="tab" aria-selected={activeTab === "advisories"} onClick={() => setActiveTab("advisories")} className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${activeTab === "advisories" ? "bg-[#1B362A] text-white shadow-sm" : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"}`}>行程提醒</button>
                <button type="button" role="tab" aria-selected={activeTab === "replan"} onClick={() => setActiveTab("replan")} className={`min-h-11 rounded-lg px-4 py-2 text-[14px] font-medium transition-all ${activeTab === "replan" ? "bg-[#1B362A] text-white shadow-sm" : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"}`}>AI 重新规划</button>
              </div>
              <p className="text-sm text-graphite">
                共 {days.length} 天｜{displayPlan.events.length} 个日程｜
                {displayPlan.pendingItems.length} 项待确认
              </p>
            </div>

            <div hidden={activeTab !== "timeline"} role="tabpanel" aria-label="每日时间轴">
              <div className={styles.chapters} aria-label="选择行程日期">{days.map((day) => <button key={day.dayNumber} type="button" onClick={() => handleDayChange(day.dayNumber)} aria-pressed={day.dayNumber === selectedDay?.dayNumber} aria-label={`第 ${day.dayNumber} 天｜${day.date}｜${day.theme}`} className={styles.chapter}>
                <span className={styles.chapterNumber}>Day {String(day.dayNumber).padStart(2, "0")}</span><span className={styles.chapterInfo}><strong>{day.theme}</strong><span>{day.date.slice(5).replace("-", ".")} · {day.events.length} 项安排</span></span>
              </button>)}</div>
              {selectedDay ? <div className={styles.companionLayout}>
                <div className={styles.timelineColumn}>
                  <div className={styles.dayHeading}><h4>{selectedDay.theme}</h4><span>{selectedDay.date}</span></div>
                  <PlanTimeline tripId={tripId} plan={displayPlan} day={selectedDay} onSaved={handlePlanSaved} selectedEventId={selectedEventId} highlightedEventId={hoveredEventId} onEventHover={setHoveredEventId} onEventSelect={handleEventSelect} advisories={advisoryData.view?.items ?? []} onAdvisories={openAdvisories} />
                </div>
                <PlanCompanion plan={displayPlan} day={selectedDay} selectedEventId={selectedEventId} highlightedEventId={hoveredEventId} onEventHover={setHoveredEventId} advisories={advisoryData} onEventSelect={handleCompanionSelect} onMap={() => setActiveTab("map")} onBudget={() => setActiveTab("budget")} onAdvisories={openAdvisories} />
              </div> : null}
            </div>
            <div hidden={activeTab !== "map"} role="tabpanel" aria-label="地图">
              {hasOpenedMap || activeTab === "map" ? (
              <PlanMap tripId={tripId} plan={displayPlan} onSaved={handlePlanSaved} selectedDayNumber={selectedDayNumber} onDayChange={handleDayChange} selectedEventId={selectedEventId} onEventSelect={handleEventSelect} />
              ) : null}
            </div>
            {activeTab === "accommodation" && <div role="tabpanel" aria-label="住宿推荐"><AccommodationPanel key={displayPlan.id} tripId={tripId} plan={displayPlan} onSaved={handlePlanSaved} /></div>}
            <div hidden={activeTab !== "checklist"} role="tabpanel" aria-label="出发前清单">
              {(hasOpenedChecklist || activeTab === "checklist") && <ChecklistPanel key={displayPlan.id} tripId={tripId} plan={displayPlan} onEvent={handleEventSelect} advisories={advisoryData.view?.items ?? []} onAdvisories={openAdvisories} focusId={checklistFocusId} />}
            </div>
            {activeTab === "advisories" && <div role="tabpanel" aria-label="行程提醒"><AdvisoryPanel data={advisoryData} plan={displayPlan} onEvent={handleEventSelect} onChecklist={(id) => { setChecklistFocusId(id); setActiveTab("checklist"); }} /></div>}
            {activeTab === "replan" && <div role="tabpanel" aria-label="AI 重新规划"><ReplanPanel key={displayPlan.id} tripId={tripId} plan={displayPlan} requestState={requestState} onSaved={handlePlanSaved} onOpenRequirements={openRequirements} /></div>}
            {activeTab === "more" && <div role="tabpanel" aria-label="更多" className="grid gap-3 py-4"><Link href={`/trips/${tripId}/execute`} className="min-h-12 rounded-lg bg-sage px-4 py-3 font-semibold text-white">进入旅行执行模式</Link>{([["replan", "AI 重新规划"], ["transport", "门到门交通"], ["advisories", "行程提醒"], ["accommodation", "住宿推荐"]] as const).map(([view, title]) => <button key={view} className="min-h-12 rounded-lg border border-sand px-4 py-3 text-left font-semibold" onClick={() => setActiveTab(view)}>{title}</button>)}</div>}
            {activeTab !== "checklist" && <button type="button" className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-lg border border-sage px-4 py-3 font-semibold text-sage sm:hidden" onClick={() => { setActiveTab("checklist"); document.getElementById("plan-views")?.scrollIntoView({ block: "start" }); }}><ListChecks className="size-5" aria-hidden="true" />打开出发前清单</button>}
            <TripBottomNav tripId={tripId} active={activeTab} onSelect={(view) => { setActiveTab(view); document.getElementById("plan-views")?.scrollIntoView({ block: "start" }); }} />
            <div hidden={activeTab !== "transport"} role="tabpanel" aria-label="门到门交通">
              <TransportOverview
                tripId={tripId}
                plan={displayPlan}
                onSaved={handlePlanSaved}
                direction={transportDirection}
                onDirectionChange={setTransportDirection}
              />
            </div>
            <div hidden={activeTab !== "budget"} role="tabpanel" aria-label="预算">
              {hasOpenedBudget || activeTab === "budget" ? (
              <PlanBudget
                tripId={tripId}
                plan={displayPlan}
                onSaved={handlePlanSaved}
              />
              ) : null}
            </div>
          </div>

        </>
      ) : (
        <div className={styles.emptyPlan}>
          <div className={styles.emptyIcon}><Sparkles size={30} strokeWidth={1.3} aria-hidden="true" /></div>
          <p className={styles.eyebrow}>A JOURNEY IN THE MAKING</p>
          <h3>你的旅行想法，已妥善收藏</h3>
          <p>{planningNotice || "行程还在等待成形。轻点下方按钮，我们会接着为你安排一路的风景与停留。"}</p>
          <button type="button" onClick={generatePlan} disabled={!canGenerate} className={styles.primaryAction}><Sparkles size={17} aria-hidden="true" />{isGenerating ? `正在生成... ${elapsedSeconds} 秒` : "一键重试生成行程"}</button>
          {isGenerating ? <button type="button" onClick={cancelGeneration} className={styles.textAction}>取消生成</button> : null}
          {feedback ? <p role={feedback.tone === "error" ? "alert" : "status"} className={feedback.tone === "error" ? styles.emptyError : styles.emptyStatus}>{feedback.message}</p> : null}
          <span className={styles.emptyFootnote}>需要调整想法时，可使用右上角的「修改需求 / 重新生成」。</span>
        </div>
      )}
    </section>
  );
}
