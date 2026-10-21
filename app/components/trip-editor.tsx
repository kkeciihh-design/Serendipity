"use client";
import Image from "next/image";
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
import { useCallback, useRef, useState, type ReactNode } from "react";
import { formatTripDateTime } from "@/lib/trip-format";
import { tripSummaryBudget, tripSummaryDates, tripSummaryDays, tripSummaryTravelers } from "@/lib/trip-summary";
import { tripDisplayTitle } from "@/lib/trip-title";
import { getTripHardTimeConstraints } from "@/lib/trip-hard-constraints";
import type { GalleryPhoto } from "@/lib/destination-gallery";
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
  navigation,
  coverPhoto,
}: {
  trip: TripEditorTrip;
  request: TripRequestClient;
  plans: PlanVersionClient[];
  selectedVersionNumber: number | null;
  planningNotice?: string | null;
  navigation?: ReactNode;
  coverPhoto?: GalleryPhoto;
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
      <header className="relative min-h-[230px] w-full overflow-hidden bg-[#14231C] text-white" data-testid="compact-trip-header">
        {coverPhoto ? (
          <div className="absolute inset-0" aria-hidden="true">
            <Image fill preload sizes="100vw" src={coverPhoto.src} alt="" className="h-full w-full object-cover" style={{ objectPosition: coverPhoto.position }} />
          </div>
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-[#14231C]/88 via-[#14231C]/72 to-[#14231C]/55" aria-hidden="true" />

        <div className="relative z-10 mx-auto w-full max-w-[1260px] px-5 py-7 sm:px-10">
        {navigation}
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div className="flex-1 min-w-0 w-full whitespace-normal break-words">
            <h1 className="font-serif text-3xl font-semibold tracking-tight whitespace-normal break-words text-white md:text-4xl" aria-label={displayTitle}>
              <button type="button" className="inline-flex min-w-0 w-full items-center gap-2 text-left" onClick={() => setIsEditingTitle(true)} aria-label={`修改旅行标题：${displayTitle}`}>
                {displayTitle}<PencilLine aria-hidden="true" className="size-4 text-white/70" />
              </button>
            </h1>
            {originalQuote && originalQuote !== displayTitle ? <blockquote className="mt-1 max-w-xl line-clamp-1 whitespace-normal break-words text-[15px] leading-6 text-white/85" title={originalQuote} aria-label="出发灵感" data-testid="trip-original-quote">“{originalQuote}”</blockquote> : null}
            <span aria-label="当前生效的旅行要素" className="mt-3 flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm text-white"><MapPin aria-hidden="true" size={14} />{summarySnapshot?.destination ?? "目的地待补充"}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm text-white"><CalendarDays aria-hidden="true" size={14} />{tripSummaryDates(summarySnapshot)}{summaryDays ? ` · ${summaryDays} 天` : ""}</span>
              {summaryTravelers ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm text-white"><Users aria-hidden="true" size={14} />{summaryTravelers}</span> : null}
              {summaryBudget ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm text-white"><Wallet aria-hidden="true" size={14} />{summaryBudget}</span> : null}
              {getTripHardTimeConstraints(summarySnapshot).map((constraint) => <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E5C5B0] bg-[#FDF3EB] px-3.5 py-1.5 text-sm font-semibold text-[#8A3F1E] shadow-sm" key={`${constraint.kind}-${constraint.date}-${constraint.time}`}><Clock3 aria-hidden="true" size={14} />{constraint.label}</span>)}
            </span>
          </div>

          <div className="flex min-w-0 items-center justify-end md:pt-1">
            <button ref={requirementsToggleRef} type="button" onClick={() => setRequirementsOpen((open) => !open)} aria-expanded={requirementsOpen} aria-controls="trip-requirements-panel" className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-sm text-white transition hover:bg-white/25">
              <SlidersHorizontal aria-hidden="true" size={14} />修改需求 / 重新生成
              <ChevronDown aria-hidden="true" size={14} className={requirementsOpen ? "rotate-180" : undefined} />
            </button>
          </div>
        </div>
        {isDirty || requestState.hasUnsavedEdits ? <p className="mt-3 text-right text-[13px] text-[#F6C9A8]" role="status">{isDirty ? "标题未保存" : "需求有未保存修改"}{isDirty && requestState.hasUnsavedEdits ? " · 需求有未保存修改" : ""}</p> : null}
        </div>
      </header>

      <div className={styles.editorShell}>
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
    </div>
  );
}
