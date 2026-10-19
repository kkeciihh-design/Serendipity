"use client";
import { businessFetch } from "@/lib/business-fetch";

import {
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Clock3,
  MapPin,
  PencilLine,
  Save,
  SlidersHorizontal,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { formatTripDateTime } from "@/lib/trip-format";
import { tripSummaryBudget, tripSummaryDates, tripSummaryDays, tripSummaryTravelers } from "@/lib/trip-summary";
import { tripDisplayTitle } from "@/lib/trip-title";
import { getTripHardTimeConstraints } from "@/lib/trip-hard-constraints";
import styles from "./trip-editor.module.css";
import {
  PlanOverview,
  type PlanRequestState,
  type PlanVersionClient,
} from "./plan-overview";
import {
  TripRequestWorkspace,
  type TripRequestClient,
} from "./trip-request-workspace";

type TripEditorTrip = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type SaveFeedback = {
  tone: "error" | "info" | "success";
  message: string;
};

const MAX_TITLE_LENGTH = 80;
const countCharacters = (text: string) => Array.from(text).length;

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return (
    payload?.error ??
    `保存失败（HTTP ${response.status}）。你正在编辑的内容没有丢，请稍后重试。`
  );
}

export function TripEditor({
  trip,
  request,
  plans,
  selectedVersionNumber,
  planningNotice = null,
}: {
  trip: TripEditorTrip;
  request: TripRequestClient;
  plans: PlanVersionClient[];
  selectedVersionNumber: number | null;
  planningNotice?: string | null;
}) {
  const router = useRouter();
  // Entry URLs and incomplete AI runs must never open the detailed editor.
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const requirementsToggleRef = useRef<HTMLButtonElement>(null);
  const [planningNoticeDismissed, setPlanningNoticeDismissed] = useState(false);
  const [currentRequest, setCurrentRequest] = useState(request);
  const [savedTrip, setSavedTrip] = useState(trip);
  const [title, setTitle] = useState(trip.title);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [requestState, setRequestState] = useState<PlanRequestState>({
    requestRevision: request.requestRevision,
    confirmed:
      request.confirmedRevision === request.requestRevision &&
      request.confirmedRequest !== null,
    hasUnsavedEdits: false,
  });
  const handleRequestStateChange = useCallback(
    (state: PlanRequestState) => setRequestState(state),
    [],
  );

  const isDirty = title !== savedTrip.title;
  const isTitleTooLong = countCharacters(title.trim()) > MAX_TITLE_LENGTH;
  const canConfirmDelete = deleteConfirmation === savedTrip.title;
  const currentPlan = plans.find((plan) => plan.isCurrent) ?? plans[0];
  const confirmedSnapshot = currentRequest.confirmedRevision === currentRequest.requestRevision
    ? currentRequest.confirmedRequest : null;
  const summarySnapshot = confirmedSnapshot ?? currentPlan?.requestSnapshot ?? currentRequest.extractedRequest;
  const summaryDays = tripSummaryDays(summarySnapshot);
  const summaryTravelers = tripSummaryTravelers(summarySnapshot, confirmedSnapshot || !currentPlan ? currentRequest.originalRequest : undefined);
  const summaryBudget = tripSummaryBudget(summarySnapshot);
  const displayTitle = tripDisplayTitle({ title: savedTrip.title, originalRequest: currentRequest.originalRequest, snapshot: summarySnapshot });
  const originalQuote = currentRequest.originalRequest.replace(/\s+/g, " ").trim();
  const focusRequirementsToggle = () => {
    requirementsToggleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    requirementsToggleRef.current?.focus({ preventScroll: true });
  };

  const saveTitle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) {
      setFeedback({
        tone: "error",
        message: "正在保存标题，请稍候，不要重复点击。",
      });
      return;
    }
    if (title.trim().length === 0) {
      setFeedback({ tone: "error", message: "旅行标题不能为空。" });
      return;
    }
    if (isTitleTooLong) {
      setFeedback({
        tone: "error",
        message: `标题过长：最多 ${MAX_TITLE_LENGTH} 字。`,
      });
      return;
    }

    const submittedTitle = title;
    setIsSaving(true);
    setFeedback({ tone: "info", message: "正在保存标题..." });
    try {
      const response = await businessFetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: submittedTitle.trim() }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { trip: TripEditorTrip };
      setSavedTrip(payload.trip);
      setTitle((current) => current === submittedTitle ? payload.trip.title : current);
      setFeedback({
        tone: "success",
        message: "标题已保存；这不会改变需求修订或确认状态。",
      });
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "保存失败。你正在编辑的内容没有丢，请稍后重试。",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTrip = async () => {
    if (isDeleting || !canConfirmDelete) {
      return;
    }

    setIsDeleting(true);
    setFeedback({ tone: "info", message: "正在删除这趟旅行..." });
    try {
      const response = await businessFetch(`/api/trips/${trip.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      router.push("/trips");
    } catch (error) {
      setIsDeleting(false);
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "删除失败。这趟旅行仍然保留，请稍后重试。",
      });
    }
  };

  return (
    <div className={styles.editor}>
      <header className={styles.tripHeader} data-testid="compact-trip-header">
        <div className={styles.headingRow}>
          <div className={styles.headingCopy}>
            <p className={styles.eyebrow}><span>SERENDIPITY / TRAVEL JOURNAL</span><span>旅行详情</span></p>
            <h1 className={styles.tripTitle} aria-label={displayTitle}>
              <button type="button" className={styles.titleButton} onClick={() => setIsEditingTitle(true)} aria-label={`修改旅行标题：${displayTitle}`}>
                {displayTitle}<PencilLine aria-hidden="true" className={styles.titleEditIcon} />
              </button>
            </h1>
            {originalQuote && originalQuote !== displayTitle ? <blockquote className={styles.originalQuote} title={originalQuote} aria-label="出发灵感" data-testid="trip-original-quote">“{originalQuote}”</blockquote> : null}
          </div>
          <button ref={requirementsToggleRef} type="button" onClick={() => setRequirementsOpen((open) => !open)} aria-expanded={requirementsOpen} aria-controls="trip-requirements-panel" className={styles.requirementsToggle}>
            <SlidersHorizontal aria-hidden="true" size={15} />修改需求 / 重新生成
            <ChevronDown aria-hidden="true" size={14} className={requirementsOpen ? styles.chevronOpen : undefined} />
          </button>
        </div>
        <div className={styles.summaryTags} aria-label="当前生效的旅行要素">
          <span className={styles.destinationTag}><MapPin aria-hidden="true" size={14} />{summarySnapshot?.destination ?? "目的地待补充"}</span>
          <span><CalendarDays aria-hidden="true" size={14} />{tripSummaryDates(summarySnapshot)}{summaryDays ? ` · ${summaryDays} 天` : ""}</span>
          {summaryTravelers ? <span><Users aria-hidden="true" size={14} />{summaryTravelers}</span> : null}
          {summaryBudget ? <span><Wallet aria-hidden="true" size={14} />{summaryBudget}</span> : null}
          {getTripHardTimeConstraints(summarySnapshot).map((constraint) => <span className={styles.hardTimeTag} key={`${constraint.kind}-${constraint.date}-${constraint.time}`}><Clock3 aria-hidden="true" size={14} />{constraint.label}</span>)}
          {summarySnapshot?.interests.slice(0, 3).map((interest) => <span className={styles.interestTag} key={interest}>{interest}</span>)}
        </div>
        {isDirty || requestState.hasUnsavedEdits ? <p className={styles.unsavedNote} role="status">{isDirty ? "标题未保存" : "需求有未保存修改"}{isDirty && requestState.hasUnsavedEdits ? " · 需求有未保存修改" : ""}</p> : null}
      </header>

      <div hidden={!isEditingTitle}>
      <form
        onSubmit={saveTitle}
        className={styles.titleForm}
      >
        <div className="flex items-center justify-between gap-3">
        <label htmlFor="trip-title" className="text-lg font-semibold text-charcoal">
          旅行标题
        </label>
        <button type="button" onClick={() => setIsEditingTitle(false)} className={styles.closeButton} aria-label="收起标题编辑"><X aria-hidden="true" size={18} /></button>
        </div>
        <input
          id="trip-title"
          name="trip-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={MAX_TITLE_LENGTH * 2}
          aria-invalid={isTitleTooLong || feedback?.tone === "error"}
          aria-describedby="trip-editor-feedback"
          className="mt-3 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base leading-7 text-charcoal focus:border-sage focus:outline-none"
        />
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="submit"
            disabled={isSaving || !isDirty}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
          >
            <Save aria-hidden="true" className="size-5" />
            {isSaving ? "正在保存..." : "保存标题"}
          </button>
          <span className="text-xs text-graphite">已保存 · {formatTripDateTime(new Date(savedTrip.updatedAt))}</span>
          <button
            type="button"
            onClick={() => {
              setShowDeleteConfirm(true);
              setDeleteConfirmation("");
            }}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-clay px-5 py-3 text-base font-semibold text-clay transition-colors hover:bg-clay-soft"
          >
            <Trash2 aria-hidden="true" className="size-5" />
            删除旅行
          </button>
        </div>
      </form>
      </div>

      <div id="trip-requirements-panel" hidden={!requirementsOpen} className={styles.requirementsPanel}>
      <div className={styles.panelHeading}><p>按你的心意，微调这趟旅程。</p><button type="button" onClick={() => setRequirementsOpen(false)} className={styles.closeButton} aria-label="收起需求编辑"><X aria-hidden="true" size={18} /></button></div>
      <TripRequestWorkspace
        initialRequest={request}
        onStateChange={handleRequestStateChange}
        onRecordChange={setCurrentRequest}
      />
      </div>

      <PlanOverview
        tripId={trip.id}
        tripTitle={displayTitle}
        originalRequest={currentRequest.originalRequest}
        planningNotice={planningNoticeDismissed ? null : planningNotice}
        plans={plans}
        selectedVersionNumber={selectedVersionNumber}
        requestState={requestState}
        onOpenRequirements={focusRequirementsToggle}
        onPlanGenerated={() => {
          setPlanningNoticeDismissed(true);
          if (!requestState.hasUnsavedEdits) setRequirementsOpen(false);
          if (!isDirty) setIsEditingTitle(false);
        }}
      />

      {feedback ? <div
        id="trip-editor-feedback"
        aria-live="polite"
        className={`min-h-11 rounded-md px-4 py-3 text-base leading-7 ${
          feedback?.tone === "error"
            ? "bg-clay-soft text-clay"
            : feedback?.tone === "success"
              ? "bg-sage-soft text-sage"
              : "bg-shell text-graphite"
        }`}
      >
        {feedback.message}
      </div> : null}

      {showDeleteConfirm ? (
        <section
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-trip-title"
          className="rounded-lg border border-clay/50 bg-clay-soft p-5 sm:p-6"
        >
          <h2
            id="delete-trip-title"
            className="flex items-center gap-2 text-xl font-semibold text-clay"
          >
            <CircleAlert aria-hidden="true" className="size-5" />
            确认删除
          </h2>
          <p className="mt-3 text-base leading-7 text-charcoal">
            删除后无法恢复。请输入这趟旅行的名称
            <strong className="mx-1">{savedTrip.title}</strong>
            来确认。
          </p>
          <input
            type="text"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            aria-label="输入旅行名称确认删除"
            className="mt-4 min-h-12 w-full rounded-md border border-clay/50 bg-white px-4 py-3 text-base leading-7 text-charcoal focus:border-clay focus:outline-none"
          />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={deleteTrip}
              disabled={!canConfirmDelete || isDeleting}
              className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-clay px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-charcoal disabled:cursor-not-allowed disabled:bg-clay/50"
            >
              <Trash2 aria-hidden="true" className="size-5" />
              {isDeleting ? "正在删除..." : "确认删除"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDeleteConfirm(false);
                setDeleteConfirmation("");
                if (!isDeleting) {
                  setFeedback(null);
                }
              }}
              disabled={isDeleting}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-md border border-charcoal/20 bg-white px-5 py-3 text-base font-medium text-charcoal transition-colors hover:border-charcoal disabled:cursor-not-allowed disabled:opacity-70"
            >
              取消
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
