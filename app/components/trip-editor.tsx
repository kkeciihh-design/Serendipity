"use client";

import {
  CircleAlert,
  HardDriveDownload,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { formatTripDateTime } from "@/lib/trip-format";
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
}: {
  trip: TripEditorTrip;
  request: TripRequestClient;
  plans: PlanVersionClient[];
  selectedVersionNumber: number | null;
}) {
  const router = useRouter();
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

    setIsSaving(true);
    setFeedback({ tone: "info", message: "正在保存标题..." });
    try {
      const response = await fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { trip: TripEditorTrip };
      setSavedTrip(payload.trip);
      setTitle(payload.trip.title);
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
      const response = await fetch(`/api/trips/${trip.id}`, {
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
    <div className="mt-5 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-sage">旅行详情</p>
          <h1 className="mt-1 text-3xl font-bold leading-9 text-charcoal">
            {savedTrip.title}
          </h1>
        </div>
        <span
          className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
            isDirty ? "bg-clay-soft text-clay" : "bg-sage-soft text-sage"
          }`}
        >
          <HardDriveDownload aria-hidden="true" className="size-4" />
          {isDirty
            ? "标题未保存"
            : `已保存 · ${formatTripDateTime(new Date(savedTrip.updatedAt))}`}
        </span>
      </header>

      <form
        onSubmit={saveTitle}
        className="rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
      >
        <label htmlFor="trip-title" className="text-lg font-semibold text-charcoal">
          旅行标题
        </label>
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

      <TripRequestWorkspace
        initialRequest={request}
        onStateChange={handleRequestStateChange}
      />

      <PlanOverview
        tripId={trip.id}
        tripTitle={savedTrip.title}
        plans={plans}
        selectedVersionNumber={selectedVersionNumber}
        requestState={requestState}
      />

      <div
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
        {feedback?.message ??
          "标题修改不进入需求修订；原话、摘要和追问答案在需求确认区统一保存。"}
      </div>

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
