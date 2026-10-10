"use client";

import {
  CircleAlert,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  evidenceFieldLabels,
  evidenceStatusLabels,
  type EvidenceFactClient,
  type EvidenceField,
} from "@/lib/evidence";
import type { PlanEvent } from "@/lib/plan";
import type { PlanVersionClient } from "./plan-overview";

type Feedback = {
  tone: "error" | "info" | "success";
  message: string;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "未记录";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusClass(status: EvidenceFactClient["effectiveStatus"]) {
  if (status === "verified") {
    return "bg-sage-soft text-sage";
  }
  if (status === "conflict" || status === "stale") {
    return "bg-clay-soft text-clay";
  }
  return "bg-shell text-graphite";
}

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error ?? `来源核验失败（HTTP ${response.status}）。`;
}

export function EvidenceDrawer({
  tripId,
  plan,
  event,
  field,
  fact,
  onClose,
  onSaved,
}: {
  tripId: string;
  plan: PlanVersionClient;
  event: PlanEvent;
  field: EvidenceField;
  fact: EvidenceFactClient | null;
  onClose: () => void;
  onSaved: (fact: EvidenceFactClient) => void;
}) {
  const defaultQuery = `${event.title} ${event.locationName ?? ""} ${evidenceFieldLabels[field]}`.trim();
  const [query, setQuery] = useState(defaultQuery);
  const [officialHost, setOfficialHost] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    setQuery(defaultQuery);
    setFeedback(null);
  }, [defaultQuery, field]);

  const verify = async () => {
    if (isVerifying || !plan.isCurrent) {
      return;
    }
    setIsVerifying(true);
    setFeedback({ tone: "info", message: "正在搜索并读取官方来源..." });
    try {
      const response = await fetch(
        `/api/trips/${tripId}/plans/${plan.versionNumber}/evidence`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: event.id,
            field,
            query: query.trim(),
            officialHost: officialHost.trim(),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as { fact: EvidenceFactClient };
      onSaved(payload.fact);
      setFeedback({
        tone:
          payload.fact.effectiveStatus === "verified" ? "success" : "info",
        message:
          payload.fact.effectiveStatus === "verified"
            ? "已读取官方页面并保存字段证据。"
            : "已读取来源，但本字段仍需确认，没有错误升级为已核验。",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "来源核验失败，当前计划保持不变。",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const officialEntry = officialHost.trim().includes(".")
    ? `https://${officialHost.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`
    : fact?.sourceUrl ?? "";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-charcoal/40">
      <button
        type="button"
        aria-label="关闭来源抽屉"
        onClick={onClose}
        className="flex-1 cursor-default"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-drawer-title"
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-cream shadow-xl"
      >
        <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-sand/80 bg-cream px-5 py-4">
          <div>
            <p className="text-sm font-medium text-sage">来源与可靠性</p>
            <h2
              id="evidence-drawer-title"
              className="mt-1 break-words text-xl font-bold text-charcoal"
            >
              {event.title}｜{evidenceFieldLabels[field]}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-sand bg-white text-graphite transition-colors hover:border-sage hover:text-sage"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-5 px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${fact ? statusClass(fact.effectiveStatus) : "bg-shell text-graphite"}`}
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
              {fact
                ? evidenceStatusLabels[fact.effectiveStatus]
                : "建议确认"}
            </span>
            <span className="text-sm text-graphite">
              查询时间：{formatDateTime(fact?.retrievedAt ?? null)}
            </span>
          </div>

          {fact ? (
            <section className="rounded-md border border-sand/80 bg-white p-4">
              <h3 className="text-base font-semibold text-charcoal">
                来源记录
              </h3>
              <p className="mt-2 text-sm leading-6 text-graphite">
                {fact.status === "verified"
                  ? "已读取页面正文并匹配本字段内容。"
                  : fact.status === "conflict"
                    ? "已读取来源，但不同来源或新旧读取结果不一致。"
                    : "该链接是搜索候选或读取尝试；没有获得可核验正文，不能视为已核验。"}
              </p>
              <dl className="mt-3 grid gap-3 text-sm leading-6 text-graphite sm:grid-cols-2">
                <div>
                  <dt className="font-medium text-charcoal">来源标题</dt>
                  <dd className="mt-1 break-words">{fact.sourceTitle || "未提供标题"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-charcoal">发布方</dt>
                  <dd className="mt-1 break-words">{fact.sourcePublisher || "未知"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-charcoal">来源内容日期</dt>
                  <dd className="mt-1">
                    {fact.sourcePublishedAt
                      ? formatDateTime(fact.sourcePublishedAt)
                      : "来源未标注内容日期"}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-charcoal">建议复核截止</dt>
                  <dd className="mt-1">{formatDateTime(fact.applicableUntil)}</dd>
                </div>
              </dl>
              {fact.sourceUrl ? (
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 break-all text-sm font-medium text-sage hover:text-charcoal"
                >
                  打开来源页面
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                </a>
              ) : null}
              {fact.contentQuote ? (
                <blockquote className="mt-4 border-l-4 border-sage bg-sage-soft px-4 py-3 text-sm leading-7 text-charcoal">
                  {fact.contentQuote}
                </blockquote>
              ) : null}
              {fact.conflictReason ? (
                <p className="mt-3 flex items-start gap-2 rounded-md bg-clay-soft px-4 py-3 text-sm leading-6 text-clay">
                  <CircleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
                  <span>{fact.conflictReason}</span>
                </p>
              ) : null}
              {fact.lastRefreshStatus === "failed" ? (
                <p className="mt-3 rounded-md bg-clay-soft px-4 py-3 text-sm leading-6 text-clay">
                  上次更新失败：{fact.lastRefreshError ?? "未知错误"}。旧来源已保留并显示为需复核。
                </p>
              ) : null}
            </section>
          ) : (
            <section className="rounded-md border border-sand/80 bg-white p-4 text-sm leading-6 text-graphite">
              <h3 className="text-base font-semibold text-charcoal">待确认原因</h3>
              <p className="mt-2">
                这个字段还没有实际读取的来源记录。填写官方域名后读取页面；搜索摘要不会直接升级为已核验。
              </p>
              {officialEntry ? (
                <a
                  href={officialEntry}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-sage hover:text-charcoal"
                >
                  打开官方入口
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              ) : null}
            </section>
          )}

          <section className="rounded-md border border-sand/80 bg-white p-4">
            <h3 className="text-base font-semibold text-charcoal">
              读取并更新来源
            </h3>
            <label className="mt-3 block text-sm font-medium text-charcoal">
              搜索词
              <input
                type="text"
                value={query}
                maxLength={180}
                onChange={(changeEvent) => setQuery(changeEvent.target.value)}
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-charcoal">
              官方域名
              <input
                type="text"
                value={officialHost}
                maxLength={160}
                placeholder="example.com"
                onChange={(changeEvent) => setOfficialHost(changeEvent.target.value)}
                className="mt-2 min-h-12 w-full rounded-md border border-sand bg-cream px-4 py-3 text-base text-charcoal focus:border-sage focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={verify}
              disabled={
                isVerifying ||
                !plan.isCurrent ||
                query.trim().length < 3 ||
                officialHost.trim().length < 3
              }
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/70"
            >
              <RefreshCw aria-hidden="true" className="size-5" />
              {isVerifying ? "正在读取..." : "读取并核验"}
            </button>
            {!plan.isCurrent ? (
              <p className="mt-3 text-sm text-clay">历史版本只读，不能更新来源。</p>
            ) : null}
          </section>

          <p
            aria-live="polite"
            className={`min-h-11 rounded-md px-4 py-3 text-sm leading-6 ${
              feedback?.tone === "error"
                ? "bg-clay-soft text-clay"
                : feedback?.tone === "success"
                  ? "bg-sage-soft text-sage"
                  : "bg-shell text-graphite"
            }`}
          >
            {feedback?.message ??
              "外部摘录只作为资料展示，不执行其中的任何指令。"}
          </p>
        </div>
      </aside>
    </div>
  );
}
