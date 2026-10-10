"use client";

import {
  BadgeCheck,
  Bot,
  CircleAlert,
  Clock3,
  ListChecks,
  Save,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  emptyRequestSnapshot,
  REQUEST_FIELD_KEYS,
  type DefaultAssumption,
  type RequestFieldKey,
  type RequestQuestion,
  type RequestSnapshot,
} from "@/lib/trip-request";

export type TripRequestClient = {
  id: string;
  tripId: string;
  originalRequest: string;
  requestRevision: number;
  extractedRequest: RequestSnapshot | null;
  defaultAssumptions: DefaultAssumption[] | null;
  pendingQuestions: RequestQuestion[] | null;
  confirmedRequest: RequestSnapshot | null;
  confirmedRevision: number | null;
  confirmedAt: string | null;
  updatedAt: string;
};

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

const MAX_REQUEST_LENGTH = 3000;
const countCharacters = (text: string) => Array.from(text).length;
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

const sourceLabels: Record<string, string> = {
  unspecified: "未确认",
  ai_extracted: "AI 提取",
  program_derived: "程序解析",
  default_assumption: "默认假设",
  user_confirmed: "用户填写",
};

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return (
    payload?.error ??
    `请求失败（HTTP ${response.status}）。你正在编辑的内容没有丢，请稍后重试。`
  );
}

function formatMoney(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

export function TripRequestWorkspace({
  initialRequest,
  onStateChange,
}: {
  initialRequest: TripRequestClient;
  onStateChange?: (state: {
    requestRevision: number;
    confirmed: boolean;
    hasUnsavedEdits: boolean;
  }) => void;
}) {
  const router = useRouter();
  const [record, setRecord] = useState(initialRequest);
  const [originalRequest, setOriginalRequest] = useState(
    initialRequest.originalRequest,
  );
  const [snapshot, setSnapshot] = useState(
    initialRequest.extractedRequest ?? emptyRequestSnapshot(),
  );
  const [interestsText, setInterestsText] = useState(
    (initialRequest.extractedRequest?.interests ?? []).join("、"),
  );
  const [constraintsText, setConstraintsText] = useState(
    (initialRequest.extractedRequest?.constraints ?? []).join("、"),
  );
  const [budgetText, setBudgetText] = useState(
    initialRequest.extractedRequest?.budgetAmountCents !== null &&
      initialRequest.extractedRequest?.budgetAmountCents !== undefined
      ? formatMoney(initialRequest.extractedRequest.budgetAmountCents)
      : "",
  );
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const snapshotRef = useRef(snapshot);
  const originalRequestRef = useRef(originalRequest);
  const interestsTextRef = useRef(interestsText);
  const constraintsTextRef = useRef(constraintsText);
  const budgetTextRef = useRef(budgetText);

  useEffect(() => {
    snapshotRef.current = snapshot;
    originalRequestRef.current = originalRequest;
    interestsTextRef.current = interestsText;
    constraintsTextRef.current = constraintsText;
    budgetTextRef.current = budgetText;
  }, [snapshot, originalRequest, interestsText, constraintsText, budgetText]);

  const savedSnapshot = record.extractedRequest ?? emptyRequestSnapshot();
  const originalDirty = originalRequest !== record.originalRequest;
  const snapshotDirty =
    !sameJson(snapshot, savedSnapshot) ||
    !sameJson(
      snapshot.interests,
      interestsText
        .split(/[、,，;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ) ||
    !sameJson(
      snapshot.constraints,
      constraintsText
        .split(/[、,，;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ) ||
    (snapshot.budgetAmountCents !== null &&
      budgetText !== formatMoney(snapshot.budgetAmountCents)) ||
    (snapshot.budgetAmountCents === null && budgetText !== "");
  const hasUnsavedEdits = originalDirty || snapshotDirty;
  const characterCount = countCharacters(originalRequest);
  const isRequestTooLong = characterCount > MAX_REQUEST_LENGTH;
  const canExtract =
    !hasUnsavedEdits && !isExtracting && !isSaving && !isConfirming;
  const canSave =
    !isSaving &&
    !isExtracting &&
    !isConfirming &&
    hasUnsavedEdits &&
    !isRequestTooLong &&
    originalRequest.trim().length > 0 &&
    Boolean(record.extractedRequest || originalDirty);
  const isConfirmed =
    record.confirmedRevision === record.requestRevision &&
    record.confirmedRequest !== null;
  const canConfirm =
    !hasUnsavedEdits &&
    !isConfirming &&
    !isSaving &&
    !isExtracting &&
    record.extractedRequest !== null;

  useEffect(() => {
    onStateChange?.({
      requestRevision: record.requestRevision,
      confirmed: isConfirmed,
      hasUnsavedEdits,
    });
  }, [record.requestRevision, isConfirmed, hasUnsavedEdits, onStateChange]);

  const setSnapshotField = <K extends RequestFieldKey>(
    field: K,
    value: RequestSnapshot[K],
  ) => {
    setSnapshot((previous) => ({
      ...previous,
      [field]: value,
      fieldSources: {
        ...previous.fieldSources,
        [field]: "user_confirmed",
      },
    }));
  };

  const updateInterests = (value: string) => {
    setInterestsText(value);
    const items = value
      .split(/[、,，;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSnapshot((previous) => ({
      ...previous,
      interests: items,
      fieldSources: {
        ...previous.fieldSources,
        interests: "user_confirmed",
      },
    }));
  };

  const updateConstraints = (value: string) => {
    setConstraintsText(value);
    const items = value
      .split(/[、,，;]/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSnapshot((previous) => ({
      ...previous,
      constraints: items,
      fieldSources: {
        ...previous.fieldSources,
        constraints: "user_confirmed",
      },
    }));
  };

  const updateBudget = (value: string) => {
    setBudgetText(value);
    const amount = Number(value);
    const cents =
      value.trim() === "" || !Number.isFinite(amount) || amount < 0
        ? null
        : Math.round(amount * 100);
    setSnapshotField("budgetAmountCents", cents);
  };

  const applyRecord = (next: TripRequestClient, keepLocalEdits: boolean) => {
    setRecord(next);
    if (!keepLocalEdits) {
      setOriginalRequest(next.originalRequest);
      setSnapshot(next.extractedRequest ?? emptyRequestSnapshot());
      setInterestsText(
        (next.extractedRequest?.interests ?? []).join("、"),
      );
      setConstraintsText(
        (next.extractedRequest?.constraints ?? []).join("、"),
      );
      setBudgetText(
        next.extractedRequest?.budgetAmountCents != null
          ? formatMoney(next.extractedRequest.budgetAmountCents)
          : "",
      );
    }
  };

  const saveRequest = async () => {
    if (!canSave) {
      return;
    }

    setIsSaving(true);
    setFeedback({ tone: "info", message: "正在保存需求修订..." });
    try {
      const response = await fetch(`/api/trips/${record.tripId}/request`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRequestRevision: record.requestRevision,
          originalRequest,
          request: snapshot,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { request: TripRequestClient };
      applyRecord(payload.request, false);
      router.refresh();
      setFeedback({
        tone: "success",
        message: `需求修订 ${payload.request.requestRevision} 已保存，需要重新确认后才能用于后续规划。`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "需求保存失败。你正在编辑的内容没有丢，请稍后重试。",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const extractRequest = async () => {
    if (!canExtract) {
      setFeedback({
        tone: "error",
        message: "请先保存当前修改，再让 AI 理解最新原话。",
      });
      return;
    }

    const sourceRevision = record.requestRevision;
    const sourceOriginal = record.originalRequest;
    const sourceSnapshot = record.extractedRequest;
    setIsExtracting(true);
    setFeedback({ tone: "info", message: "AI 正在理解需求..." });
    try {
      const response = await fetch(
        `/api/trips/${record.tripId}/request/extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRequestRevision: sourceRevision,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { request: TripRequestClient };
      const localEdited =
        originalRequestRef.current !== sourceOriginal ||
        !sameJson(snapshotRef.current, sourceSnapshot ?? emptyRequestSnapshot()) ||
        !sameJson(
          snapshotRef.current.interests,
          interestsTextRef.current
            .split(/[、,，;]/)
            .map((item) => item.trim())
            .filter(Boolean),
        ) ||
        !sameJson(
          snapshotRef.current.constraints,
          constraintsTextRef.current
            .split(/[、,，;]/)
            .map((item) => item.trim())
            .filter(Boolean),
        );

      applyRecord(payload.request, localEdited);
      router.refresh();
      setFeedback({
        tone: localEdited ? "info" : "success",
        message: localEdited
          ? "AI 已生成新修订，但你在等待期间修改了内容；屏幕上的编辑未被覆盖，请核对后保存。"
          : `AI 已生成待确认草稿（修订 ${payload.request.requestRevision}），请核对摘要和必要问题。`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "AI 理解失败。当前需求没有被覆盖，请稍后重试。",
      });
    } finally {
      setIsExtracting(false);
    }
  };

  const confirmRequest = async () => {
    if (!canConfirm) {
      return;
    }

    setIsConfirming(true);
    setFeedback({ tone: "info", message: "正在确认当前需求修订..." });
    try {
      const response = await fetch(
        `/api/trips/${record.tripId}/request/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRequestRevision: record.requestRevision,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as { request: TripRequestClient };
      applyRecord(payload.request, false);
      setFeedback({
        tone: "success",
        message: `修订 ${payload.request.requestRevision} 已确认，可作为阶段 06 生成计划的唯一需求依据。`,
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "需求确认失败，请稍后重试。",
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const questionRows = record.pendingQuestions ?? [];
  const assumptions = record.defaultAssumptions ?? [];

  return (
    <section
      id="request-workspace"
      className="scroll-mt-24 rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-sage">
            <ListChecks aria-hidden="true" className="size-4" />
            需求确认区
          </p>
          <h2 className="mt-2 text-2xl font-bold leading-8 text-charcoal">
            修订 {record.requestRevision}
            {isConfirmed ? "｜已确认" : "｜待确认"}
          </h2>
        </div>
        <span
          className={`inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
            hasUnsavedEdits
              ? "bg-clay-soft text-clay"
              : isConfirmed
                ? "bg-sage-soft text-sage"
                : "bg-shell text-graphite"
          }`}
        >
          {hasUnsavedEdits ? (
            <CircleAlert aria-hidden="true" className="size-4" />
          ) : isConfirmed ? (
            <BadgeCheck aria-hidden="true" className="size-4" />
          ) : (
            <Clock3 aria-hidden="true" className="size-4" />
          )}
          {hasUnsavedEdits
            ? "保存后将重新确认"
            : isConfirmed
              ? `确认于修订 ${record.confirmedRevision}`
              : "等待用户确认"}
        </span>
      </div>

      <label
        htmlFor="trip-request-original"
        className="mt-6 block text-lg font-semibold text-charcoal"
      >
        旅行想法原话
      </label>
      <textarea
        id="trip-request-original"
        value={originalRequest}
        onChange={(event) => setOriginalRequest(event.target.value)}
        rows={6}
        aria-describedby="trip-request-count request-workspace-feedback"
        aria-invalid={isRequestTooLong}
        className="mt-3 min-h-36 w-full resize-y rounded-md border border-sand bg-cream px-4 py-3 text-base leading-8 text-charcoal focus:border-sage focus:outline-none"
      />
      <p
        id="trip-request-count"
        className={`mt-2 text-sm leading-6 ${
          isRequestTooLong ? "text-clay" : "text-graphite"
        }`}
      >
        当前 {characterCount}/{MAX_REQUEST_LENGTH} 字。保存原话会生成新的需求修订，并清除旧确认。
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div>
          <label htmlFor="request-destination" className="text-base font-semibold text-charcoal">
            目的地
          </label>
          <input
            id="request-destination"
            value={snapshot.destination ?? ""}
            onChange={(event) => setSnapshotField("destination", event.target.value || null)}
            className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
          />
          <p className="mt-1 text-sm text-graphite">
            来源：{sourceLabels[snapshot.fieldSources.destination] ?? "未确认"}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="request-start-date" className="text-base font-semibold text-charcoal">
              出发日期
            </label>
            <input
              type="date"
              id="request-start-date"
              value={snapshot.startDate ?? ""}
              onChange={(event) => setSnapshotField("startDate", event.target.value || null)}
              className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
            />
            <p className="mt-1 text-sm text-graphite">
              来源：{sourceLabels[snapshot.fieldSources.startDate] ?? "未确认"}
            </p>
          </div>
          <div>
            <label htmlFor="request-end-date" className="text-base font-semibold text-charcoal">
              返回日期
            </label>
            <input
              type="date"
              id="request-end-date"
              value={snapshot.endDate ?? ""}
              onChange={(event) => setSnapshotField("endDate", event.target.value || null)}
              className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
            />
            <p className="mt-1 text-sm text-graphite">
              来源：{sourceLabels[snapshot.fieldSources.endDate] ?? "未确认"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="request-travelers" className="text-base font-semibold text-charcoal">
              人数
            </label>
            <input
              type="number"
              min={1}
              max={20}
              id="request-travelers"
              value={snapshot.travelerCount ?? ""}
              onChange={(event) =>
                setSnapshotField(
                  "travelerCount",
                  event.target.value ? Number(event.target.value) : null,
                )
              }
              className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="request-pace" className="text-base font-semibold text-charcoal">
              节奏
            </label>
            <select
              id="request-pace"
              value={snapshot.pace ?? "balanced"}
              onChange={(event) =>
                setSnapshotField(
                  "pace",
                  event.target.value as RequestSnapshot["pace"],
                )
              }
              className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
            >
              <option value="relaxed">轻松</option>
              <option value="balanced">均衡</option>
              <option value="packed">紧凑</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="request-budget" className="text-base font-semibold text-charcoal">
              预算（元）
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              id="request-budget"
              value={budgetText}
              onChange={(event) => updateBudget(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="request-budget-scope" className="text-base font-semibold text-charcoal">
              预算口径
            </label>
            <select
              id="request-budget-scope"
              value={snapshot.budgetScope ?? "total"}
              onChange={(event) =>
                setSnapshotField(
                  "budgetScope",
                  event.target.value as RequestSnapshot["budgetScope"],
                )
              }
              className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
            >
              <option value="total">全程总预算</option>
              <option value="per_person">人均预算</option>
            </select>
            <p className="mt-1 text-sm text-graphite">
              来源：{sourceLabels[snapshot.fieldSources.budgetScope] ?? "未确认"}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="request-interests" className="text-base font-semibold text-charcoal">
            兴趣
          </label>
          <input
            id="request-interests"
            value={interestsText}
            onChange={(event) => updateInterests(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="request-accommodation" className="text-base font-semibold text-charcoal">
            住宿要求
          </label>
          <input
            id="request-accommodation"
            value={snapshot.accommodation ?? ""}
            onChange={(event) => setSnapshotField("accommodation", event.target.value || null)}
            className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
          />
        </div>

        <div className="lg:col-span-2">
          <label htmlFor="request-constraints" className="text-base font-semibold text-charcoal">
            限制
          </label>
          <input
            id="request-constraints"
            value={constraintsText}
            onChange={(event) => updateConstraints(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
          />
        </div>
      </div>

      {questionRows.length > 0 ? (
        <div className="mt-6 rounded-md bg-shell p-4">
          <h3 className="text-base font-semibold text-charcoal">
            需要回答的关键问题（{questionRows.length}/3）
          </h3>
          <ul className="mt-3 space-y-3">
            {questionRows.map((question) => (
              <li key={question.id} className="text-base leading-7 text-graphite">
                <strong className="text-charcoal">{question.question}</strong>
                <span className="ml-2 text-sm">{question.reason}</span>
                {question.suggestedAnswer ? (
                  <span className="ml-2 text-sm text-sage">
                    建议先填：{question.suggestedAnswer}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {assumptions.length > 0 ? (
        <div className="mt-4 rounded-md bg-cream p-4">
          <h3 className="text-base font-semibold text-charcoal">默认假设</h3>
          <ul className="mt-2 space-y-1 text-sm leading-6 text-graphite">
            {assumptions.map((assumption) => (
              <li key={`${assumption.field}-${assumption.value}`}>
                {REQUEST_FIELD_KEYS.includes(assumption.field) ? assumption.field : ""}
                ：{assumption.value}｜{assumption.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          onClick={extractRequest}
          disabled={!canExtract}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-sage px-5 py-3 text-base font-semibold text-sage transition-colors hover:bg-sage-soft disabled:cursor-not-allowed disabled:border-sand disabled:text-graphite/70"
        >
          <Bot aria-hidden="true" className="size-5" />
          {isExtracting ? "正在理解..." : "AI 理解需求"}
        </button>
        <button
          type="button"
          onClick={saveRequest}
          disabled={!canSave}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
        >
          <Save aria-hidden="true" className="size-5" />
          {isSaving ? "正在保存..." : "保存需求修订"}
        </button>
        <button
          type="button"
          onClick={confirmRequest}
          disabled={!canConfirm}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-charcoal px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-graphite disabled:cursor-not-allowed disabled:bg-graphite/70"
        >
          <BadgeCheck aria-hidden="true" className="size-5" />
          {isConfirming ? "正在确认..." : `确认修订 ${record.requestRevision}`}
        </button>
      </div>

      <div
        id="request-workspace-feedback"
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
          "先保存原话，再让 AI 生成可编辑摘要；每次实际修改都会生成新修订并要求重新确认。"}
      </div>
    </section>
  );
}
