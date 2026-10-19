import {
  explicitTripDays,
  normalizeRequestSnapshot,
  requestToday,
  validateRequestSnapshot,
  type RequestSnapshot,
} from "./trip-request";
import type { TripRequestRecord } from "./trip-request-service";
import type { PlanVersionRecord } from "./plan-service";

export const AUTO_PLANNING_STAGES = [
  { id: "saving", label: "正在保存旅行想法..." },
  { id: "understanding", label: "正在理解你的旅行想法..." },
  { id: "preparing", label: "正在补齐日期与出行偏好..." },
  { id: "confirming", label: "正在确认本次旅行需求..." },
  { id: "planning", label: "正在为你排布每日行程..." },
] as const;

export type AutoPlanningStage = (typeof AUTO_PLANNING_STAGES)[number]["id"];

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function suggestedStartDate(originalRequest: string, now: Date) {
  const today = requestToday(now);
  // Keep a stated approximate month instead of replacing it with next week.
  const monthPeriod = originalRequest.match(/(?:(\d{4})年)?(\d{1,2})\s*月\s*(初|上旬|中旬|中|下旬|底|末)/);
  if (monthPeriod) {
    const month = Number(monthPeriod[2]);
    if (month >= 1 && month <= 12) {
      const day = /初|上旬/.test(monthPeriod[3]) ? "01" : /中/.test(monthPeriod[3]) ? "15" : "25";
      let year = Number(monthPeriod[1] ?? today.slice(0, 4));
      let value = `${year}-${String(month).padStart(2, "0")}-${day}`;
      if (!monthPeriod[1] && value < today) {
        // If we are already in the requested period, use a nearby future day.
        if (value.slice(0, 7) === today.slice(0, 7)) return addDays(today, 1);
        year += 1;
        value = `${year}-${String(month).padStart(2, "0")}-${day}`;
      }
      return value;
    }
  }
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (8 - weekday) % 7 || 7);
}

/** Defaults are opt-in for one-click creation; manual draft validation stays strict. */
export function completeAutoPlanningRequest(
  originalRequest: string,
  extracted: RequestSnapshot,
  now = new Date(),
): RequestSnapshot {
  const snapshot = normalizeRequestSnapshot({
    ...extracted,
    fieldSources: { ...extracted.fieldSources },
  });
  const chineseNights: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3 };
  const nights = originalRequest.match(/(\d{1,2}|[一二两三])\s*(?:晚|夜)/)?.[1];
  const statedDays = explicitTripDays(originalRequest) ?? (nights ? (chineseNights[nights] ?? Number(nights)) + 1 : null);
  const days = statedDays ?? 2;

  if (!snapshot.startDate && !snapshot.endDate) {
    snapshot.startDate = suggestedStartDate(originalRequest, now);
    snapshot.endDate = addDays(snapshot.startDate, days - 1);
    snapshot.fieldSources.startDate = "default_assumption";
    snapshot.fieldSources.endDate = "default_assumption";
  } else if (snapshot.startDate && !snapshot.endDate) {
    snapshot.endDate = addDays(snapshot.startDate, days - 1);
    snapshot.fieldSources.endDate = statedDays === null ? "default_assumption" : "program_derived";
  } else if (!snapshot.startDate && snapshot.endDate) {
    snapshot.startDate = addDays(snapshot.endDate, -(days - 1));
    snapshot.fieldSources.startDate = statedDays === null ? "default_assumption" : "program_derived";
  }
  // No amount was provided: leave the optional budget genuinely unspecified.
  if (snapshot.budgetAmountCents === null) {
    snapshot.budgetScope = null;
    snapshot.fieldSources.budgetScope = "unspecified";
  }
  return snapshot;
}

export class AutoPlanningError extends Error {
  constructor(
    message: string,
    readonly tripId: string | null,
    readonly recoverInWorkspace: boolean,
  ) {
    super(message);
    this.name = "AutoPlanningError";
  }
}

export function autoPlanningRecoveryUrl(tripId: string, message: string) {
  const query = new URLSearchParams({ planningNotice: message });
  return `/trips/${encodeURIComponent(tripId)}?${query}`;
}

type PlanningFetch = (input: string, init?: RequestInit) => Promise<Response>;
const isAIStage = (stage: AutoPlanningStage) => stage === "understanding" || stage === "planning";

class PlanningRequestError extends AutoPlanningError {
  constructor(
    message: string,
    tripId: string | null,
    recoverInWorkspace: boolean,
    readonly retryable = false,
    readonly conflict = false,
    readonly reloadRequired = false,
  ) {
    super(message, tripId, recoverInWorkspace);
  }
}

async function planningRequest<T>(
  context: { fetcher: PlanningFetch; tripId: string | null; stage: AutoPlanningStage; signal?: AbortSignal },
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await context.fetcher(url, {
      method,
      signal: context.signal,
      ...(method === "GET" ? { cache: "no-store" } : {}),
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const transient = error instanceof TypeError || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
    const aiFailure = isAIStage(context.stage);
    throw new PlanningRequestError(
      aiFailure
        ? "旅行想法已保存，AI 连接暂时中断。稍后可以一键重试生成行程。"
        : context.tripId
          ? "旅行已保存，规划暂时中断。请重试，或打开已保存旅行继续；不会重复创建。"
          : "保存失败。你输入的内容没有丢，请稍后重试。",
      context.tripId, aiFailure, transient,
    );
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // Restore and revision conflicts always stop writes, including automatic retries.
    const interrupted = response.status === 409 || response.status === 423 || Boolean(payload?.reloadRequired);
    const generationInProgress = context.stage === "planning" && response.status === 409 &&
      payload?.category === "generation_in_progress" && !payload?.reloadRequired;
    const aiFailure = (!interrupted || generationInProgress) && isAIStage(context.stage);
    const detail = typeof payload?.error === "string" ? payload.error : `请求未完成（HTTP ${response.status}），请稍后重试。`;
    const message = generationInProgress
      ? "旅行想法已保存，行程仍在生成中。稍后可以在这里查看或重试。"
      : aiFailure
      ? payload?.category === "configuration"
        ? "旅行想法已保存。请先在设置中配置可用的 AI 服务，之后即可继续生成行程。"
        : `旅行想法已保存，AI 暂时未能完成规划。${detail} 稍后可以一键重试生成行程。`
      : detail;
    const retryable = !interrupted && (
      ["timeout", "network"].includes(payload?.category) ||
      (!payload?.category && [408, 502, 503, 504].includes(response.status))
    );
    throw new PlanningRequestError(message, context.tripId, aiFailure, retryable, response.status === 409, response.status === 423 || Boolean(payload?.reloadRequired));
  }
  if (!payload) {
    // A truncated success response may already have committed its plan.
    throw new PlanningRequestError("服务响应暂时未能读取，旅行想法已保留，请稍后重试。", context.tripId, isAIStage(context.stage), true);
  }
  return payload as T;
}

/** Retry only generation, with the same optimistic guard and a read before writing again. */
export async function generatePlanWithRetry(input: {
  tripId: string;
  expectedRequestRevision: number;
  expectedPlanVersion: number | null;
  fetcher: PlanningFetch;
  signal?: AbortSignal;
}): Promise<{ plan: PlanVersionRecord }> {
  const context = { fetcher: input.fetcher, tripId: input.tripId, stage: "planning" as const, signal: input.signal };
  const generate = () => planningRequest<{ plan: PlanVersionRecord }>(context, `/api/trips/${input.tripId}/plans/generate`, "POST", {
    expectedRequestRevision: input.expectedRequestRevision,
    expectedPlanVersion: input.expectedPlanVersion,
  });
  const completedPlan = async () => {
    input.signal?.throwIfAborted();
    try {
      const { plans } = await planningRequest<{ plans: PlanVersionRecord[] }>(context, `/api/trips/${input.tripId}/plans`, "GET");
      return plans.find((plan) => plan.isCurrent && plan.requirementUpToDate &&
        plan.requestRevision === input.expectedRequestRevision && plan.versionNumber === (input.expectedPlanVersion ?? 0) + 1);
    } catch (error) {
      if (input.signal?.aborted || !(error instanceof PlanningRequestError) || !error.retryable) throw error;
      // A network failure while checking cannot bypass the optimistic version guard.
      return undefined;
    }
  };

  input.signal?.throwIfAborted();
  try {
    return await generate();
  } catch (error) {
    if (input.signal?.aborted || !(error instanceof PlanningRequestError) || !error.retryable) throw error;
    const saved = await completedPlan();
    if (saved) return { plan: saved };
  }

  input.signal?.throwIfAborted();
  try {
    return await generate();
  } catch (error) {
    if (input.signal?.aborted || !(error instanceof PlanningRequestError) || error.reloadRequired) throw error;
    if (error.retryable || error.conflict) {
      // The first call can finish between the read and the guarded retry.
      const saved = await completedPlan();
      if (saved) return { plan: saved };
    }
    throw error;
  }
}

/** Each dependent write uses the revision actually returned by the previous write. */
export async function createTripWithPlan(input: {
  originalRequest: string;
  fetcher: PlanningFetch;
  onStage?: (stage: AutoPlanningStage) => void;
  now?: Date;
  existingTripId?: string;
  signal?: AbortSignal;
}) {
  let tripId: string | null = input.existingTripId ?? null;
  let stage: AutoPlanningStage = "saving";
  const changeStage = (next: AutoPlanningStage) => {
    stage = next;
    input.onStage?.(next);
  };
  const api = <T>(url: string, method: string, body?: unknown) => planningRequest<T>({ fetcher: input.fetcher, tripId, stage, signal: input.signal }, url, method, body);

  try {
    changeStage("saving");
    let record: TripRequestRecord | null = null;
    let revision: number;
    if (tripId) {
      const result = await api<{ request: TripRequestRecord }>(`/api/trips/${tripId}/request`, "GET");
      record = result.request;
      if (record.originalRequest !== input.originalRequest) {
        throw new AutoPlanningError("这趟旅行的想法已修改，请打开已保存旅行查看最新内容。", tripId, false);
      }
      revision = record.requestRevision;
    } else {
      const result = await api<{ trip: { id: string; request: { requestRevision: number } } }>("/api/trips", "POST", { originalRequest: input.originalRequest });
      tripId = result.trip.id;
      revision = result.trip.request.requestRevision;
    }

    if (!record?.extractedRequest) {
      changeStage("understanding");
      record = (await api<{ request: TripRequestRecord }>(`/api/trips/${tripId}/request/extract`, "POST", { expectedRequestRevision: revision })).request;
    }
    if (!record.extractedRequest) {
      throw new AutoPlanningError("旅行想法已保存，但 AI 没有返回可用的需求。请在这里补充或重新理解原话。", tripId, true);
    }

    changeStage("preparing");
    const request = completeAutoPlanningRequest(input.originalRequest, record.extractedRequest, input.now);
    const errors = validateRequestSnapshot(request, input.now ?? new Date(), "confirmation");
    if (errors.length) {
      throw new AutoPlanningError(`旅行想法已保存，AI 整理的需求还需要核对：${errors[0]}`, tripId, true);
    }
    record = (await api<{ request: TripRequestRecord }>(`/api/trips/${tripId}/request`, "PATCH", {
      expectedRequestRevision: record.requestRevision,
      request,
    })).request;

    changeStage("confirming");
    record = (await api<{ request: TripRequestRecord }>(`/api/trips/${tripId}/request/confirm`, "POST", {
      expectedRequestRevision: record.requestRevision,
    })).request;
    if (record.confirmedRevision !== record.requestRevision || !record.confirmedRequest) {
      throw new AutoPlanningError("需求尚未确认成功，请打开已保存旅行查看当前修订。", tripId, false);
    }

    changeStage("planning");
    await generatePlanWithRetry({
      tripId,
      expectedRequestRevision: record.requestRevision,
      expectedPlanVersion: null,
      fetcher: input.fetcher,
      signal: input.signal,
    });
    return tripId;
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (error instanceof AutoPlanningError) throw error;
    const aiFailure = isAIStage(stage);
    const message = aiFailure
      ? "旅行想法已保存，AI 连接暂时中断。稍后可以一键重试生成行程。"
      : tripId
        ? "旅行已保存，规划暂时中断。请重试，或打开已保存旅行继续；不会重复创建。"
        : "保存失败。你输入的内容没有丢，请稍后重试。";
    throw new AutoPlanningError(message, tripId, aiFailure);
  }
}
