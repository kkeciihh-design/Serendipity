"use client";
import { businessFetch } from "@/lib/business-fetch";

import { BookOpenCheck, Check, ChevronRight, CircleAlert, Clock3, MapPin, RefreshCw, Route, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AttractionCard, AttractionRecommendations, AttractionReplacementPreview } from "@/lib/attractions";
import { formatMoneyRange, type BudgetSummary } from "@/lib/budget";
import type { PlanEvent } from "@/lib/plan";
import { dateLabel, Photo, SourceLink, FactBox, Gallery } from "./recommendation-ui";
import type { PlanVersionClient } from "./plan-overview";
import { RouteSummary } from "./route-summary";
import styles from "./plan-timeline.module.css";

type Feedback = { error: boolean; message: string };
type Action = "preview" | "apply" | "keep";

function CardDetails({ card }: { card: AttractionCard }) {
  return <div className="space-y-5">
    <Gallery card={card} />
    <p className="text-base leading-7 text-graphite">{card.description}</p>
    <section className="rounded-md bg-sage-soft p-4">
      <h3 className="flex items-center gap-2 font-semibold text-charcoal"><Sparkles aria-hidden="true" className="size-5 text-sage" />为什么适合这一天</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-charcoal">{card.reasons.map((reason, index) => <li key={index} className="flex gap-2"><span aria-hidden="true" className="text-sage">·</span><span>{reason}</span></li>)}</ul>
    </section>
    {card.warnings.length ? <div className="rounded-md bg-clay-soft p-4 text-sm leading-6 text-clay"><p className="flex items-center gap-2 font-semibold"><CircleAlert aria-hidden="true" className="size-5" />出发前需核对</p><ul className="mt-2 list-disc space-y-1 pl-5">{card.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-sand/80 bg-white p-4">
        <dt className="flex items-center gap-2 font-semibold"><Clock3 aria-hidden="true" className="size-4 text-sage" />建议游玩</dt>
        <dd className="mt-2 text-sm leading-6 text-graphite">{card.visitMinutes.min}–{card.visitMinutes.max} 分钟 · 规则估算<p className="mt-1">{card.visitMinutes.notes}</p></dd>
      </div>
      <div className="rounded-md border border-sand/80 bg-white p-4">
        <dt className="font-semibold">建议时段</dt><dd className="mt-2 text-sm leading-6 text-graphite">{card.suggestedTime}<p className="mt-1">第 {card.dayNumber} 天 · {card.date}</p></dd>
      </div>
      <FactBox title="门票" fact={card.ticket} sources={card.sources}><p className="font-semibold text-charcoal">{formatMoneyRange(card.ticket.minCents, card.ticket.maxCents)} / 人</p></FactBox>
      <FactBox title="预约" fact={card.reservation} sources={card.sources}><p className="font-semibold text-charcoal">{card.reservation.required === true ? "需要预约，尚未确认预约成功" : card.reservation.required === false ? "来源未要求预约，出发前仍需复核" : "预约要求未知"}</p></FactBox>
      <FactBox title="开放时间" fact={card.opening} sources={card.sources}><p>资料适用期：{card.opening.applicableFrom ?? "起始日期未明确"} 至 {card.opening.applicableUntil ?? "截止日期未明确"}</p></FactBox>
    </dl>
    <section aria-label="前后站衔接" className="rounded-md border border-sand/80 bg-white p-4">
      <h3 className="flex items-center gap-2 font-semibold"><Route aria-hidden="true" className="size-5 text-sage" />与前后站的关系</h3>
      <div className="mt-3 space-y-4 text-sm leading-6 text-graphite">
        <div><p className="font-medium text-charcoal">上一站：{card.previousStop ?? "当天首站"}</p>{card.incomingRoute ? <>{card.incomingRoute.distanceMeters === null ? <p className="mt-1">距离未知，请按路线来源复核。</p> : null}<RouteSummary route={card.incomingRoute} /></> : <p className="mt-1">{card.previousStop ? "距离、交通方式与耗时尚未核验，需补查路线。" : "当天没有上一站；到达景点的交通仍需按实际起点核对。"}</p>}</div>
        <div><p className="font-medium text-charcoal">下一站：{card.nextStop ?? "当天末站"}</p>{card.outgoingRoute ? <>{card.outgoingRoute.distanceMeters === null ? <p className="mt-1">距离未知，请按路线来源复核。</p> : null}<RouteSummary route={card.outgoingRoute} /></> : <p className="mt-1">{card.nextStop ? "距离、交通方式与耗时尚未核验，需补查路线。" : "当天没有后续安排。"}</p>}</div>
      </div>
    </section>
    <details className="rounded-md border border-sand/80 bg-white p-4">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-sage"><BookOpenCheck aria-hidden="true" className="size-5" />全部资料来源（{card.sources.length}）</summary>
      <ul className="mt-3 space-y-4">{card.sources.map((source) => <li key={source.id} className="text-sm leading-6 text-graphite"><SourceLink source={source} /><p>{source.publisher} · 查阅于 {dateLabel(source.retrievedAt)}</p>{source.quote ? <blockquote className="mt-1 border-l-2 border-sand pl-3">{source.quote}</blockquote> : null}</li>)}</ul>
      <p className="mt-3 text-sm leading-6 text-graphite">地点和图片来源不能替代门票、营业与预约的逐项确认。</p>
    </details>
  </div>;
}

function budgetLabel(budget: BudgetSummary) {
  return `${formatMoneyRange(budget.totalMinCents, budget.totalMaxCents)}${budget.unknownItemCount ? `，另有 ${budget.unknownItemCount} 项金额未知` : ""}`;
}

function ReplacementPreview({ preview }: { preview: AttractionReplacementPreview }) {
  return <section aria-label="替换预览" className="rounded-md border-2 border-sage bg-white p-4">
    <h3 className="text-lg font-semibold text-charcoal">替换预览 · {preview.card.name}</h3>
    <p className="mt-1 text-sm leading-6 text-graphite">确认下方变化后应用，才会保存新的计划版本。</p>
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-charcoal">{preview.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
    <dl className="mt-4 grid gap-3 rounded-md bg-cream p-3 text-sm leading-6 sm:grid-cols-2">
      <div><dt className="font-semibold">替换前 · 全程预算</dt><dd>{budgetLabel(preview.beforeBudget)}</dd></div>
      <div><dt className="font-semibold">替换后 · 全程预算</dt><dd>{budgetLabel(preview.afterBudget)}</dd></div>
    </dl>
    {preview.conflicts.length ? <div role="alert" className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6 text-clay"><p className="font-semibold">存在冲突，不能应用</p><ul className="mt-1 list-disc pl-5">{preview.conflicts.map((conflict, index) => <li key={index}>{conflict}</li>)}</ul></div> : null}
    {preview.warnings.length ? <div className="mt-3 rounded-md bg-shell p-3 text-sm leading-6 text-graphite"><p className="font-semibold">仍需确认</p><ul className="mt-1 list-disc pl-5">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
  </section>;
}

function AttractionDrawer({ event, visitLabel, data, loading, feedback, busy, preview, onRetry, onAction, onCancelPreview, onClose }: {
  event: PlanEvent; visitLabel: string; data: AttractionRecommendations | null; loading: boolean;
  feedback: Feedback | null; busy: Action | null; preview: AttractionReplacementPreview | null;
  onRetry: () => void; onAction: (action: Action, candidateId?: string) => void; onCancelPreview: () => void; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const saving = busy === "apply" || busy === "keep";
  const selectedCard = selectedId ? data?.candidates.find((card) => card.id === selectedId) ?? null : data?.current ?? null;
  const canReplace = data?.canReplace && !data.readOnly;
  const isAlternative = selectedId !== null;
  const currentConflict = !isAlternative && data?.current?.eligibility === "excluded";

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="attraction-drawer-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-charcoal backdrop:bg-charcoal/40">
    <div className="ml-auto flex h-full w-full max-w-2xl flex-col bg-cream shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sand/80 px-4 py-4 sm:px-6">
        <div className="min-w-0"><p className="text-sm font-medium text-sage">景点小档案 · 第 {event.dayNumber} 天 · {visitLabel}</p><h2 id="attraction-drawer-title" className="mt-1 break-words text-xl font-bold">{selectedCard?.name ?? event.title}</h2><p className="mt-1 text-sm text-graphite">{event.date} · {isAlternative ? "替换候选" : "当前安排"}{data?.readOnly ? " · 历史版本只读" : ""}</p></div>
        <button ref={closeRef} type="button" onClick={onClose} disabled={saving} aria-label="关闭景点详情" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-sand bg-white text-graphite hover:border-sage disabled:opacity-50"><X aria-hidden="true" className="size-5" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        {loading ? <p role="status" className="rounded-md bg-shell p-4 text-sm text-graphite">正在读取这一天的景点资料…</p> : null}
        {feedback ? <div role={feedback.error ? "alert" : "status"} className={`rounded-md p-4 text-sm leading-6 ${feedback.error ? "bg-clay-soft text-clay" : "bg-sage-soft text-sage"}`}><p>{feedback.message}</p>{feedback.error && !data ? <button type="button" onClick={onRetry} disabled={loading} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-clay px-3 font-semibold disabled:opacity-50"><RefreshCw aria-hidden="true" className="size-4" />重试读取</button> : null}</div> : null}
        {data?.protectionReasons.length ? <div className="rounded-md bg-shell p-4 text-sm leading-6 text-graphite">{data.protectionReasons.map((reason, index) => <p key={index}>{reason}</p>)}</div> : null}
        {data?.notices.length ? <div className="rounded-md border border-sand p-4 text-sm leading-6 text-graphite">{data.notices.map((notice, index) => <p key={index}>{notice}</p>)}</div> : null}
        {data ? <section aria-label="景点选择" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {isAlternative ? <button type="button" onClick={() => { setSelectedId(null); onCancelPreview(); }} disabled={busy !== null} className="min-h-11 rounded-md border border-sage bg-white px-3 text-sm font-semibold text-sage disabled:opacity-50">返回当前安排</button> : null}
            <button type="button" onClick={() => setShowAlternatives(!showAlternatives)} aria-expanded={showAlternatives} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sand bg-white px-3 text-sm font-semibold text-graphite hover:border-sage">{showAlternatives ? "收起" : "查看"}其他候选（{data.candidates.length}）<ChevronRight aria-hidden="true" className={`size-4 ${showAlternatives ? "rotate-90" : ""}`} /></button>
          </div>
          {showAlternatives ? <div className="space-y-2">{data.candidates.length ? data.candidates.map((card) => <button key={card.id} type="button" onClick={() => { setSelectedId(card.id); onCancelPreview(); }} disabled={busy !== null} aria-pressed={selectedId === card.id} className={`flex min-h-20 w-full items-start justify-between gap-3 rounded-md border p-3 text-left disabled:opacity-50 ${selectedId === card.id ? "border-sage bg-sage-soft" : "border-sand bg-white hover:border-sage"}`}><span className="min-w-0"><span className="block font-semibold">{card.name}</span><span className="mt-1 block text-sm leading-6 text-graphite">{card.reasons[0] ?? card.description}</span></span><ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-sage" /></button>) : <p className="rounded-md bg-shell p-3 text-sm leading-6 text-graphite">当前没有合适的其他候选，保留已有安排并核对待确认资料。</p>}</div> : null}
          {data.excluded.length ? <details className="rounded-md bg-shell px-3 text-sm leading-6 text-graphite"><summary className="flex min-h-11 cursor-pointer items-center">为什么有 {data.excluded.length} 项未入选</summary><ul className="space-y-2 pb-3">{data.excluded.map((item) => <li key={item.id}><span className="font-semibold">{item.name}</span>：{item.reasons.join("；")}</li>)}</ul></details> : null}
        </section> : null}
        {preview ? <ReplacementPreview preview={preview} /> : null}
        {selectedCard ? <CardDetails key={selectedCard.id} card={preview?.card ?? selectedCard} /> : data ? <div className="space-y-4"><Photo photo={null} /><p className="rounded-md bg-white p-4 text-sm leading-6 text-graphite">还没有与“{data.eventName}”准确对应的景点资料。图片、门票和预约保持待确认；可展开候选查看已整理的地点。</p><p className="text-sm leading-6 text-graphite">当前安排：{event.startTime}–{event.endTime} · {event.locationName ?? "地点待确认"}{event.note ? ` · ${event.note}` : ""}</p></div> : null}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-sand/80 bg-cream px-4 py-3 sm:px-6">
        {data?.readOnly ? <p className="py-2 text-sm text-graphite">历史版本只读，切换到当前计划后可保留或替换。</p> : preview ? <div className="grid grid-cols-[1fr_auto] gap-3"><button type="button" onClick={() => onAction("apply", preview.candidateId)} disabled={busy !== null || !canReplace || !preview.canApply} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-sage px-3 py-3 font-semibold text-white hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/50"><Check aria-hidden="true" className="size-5" />{saving ? "正在保存新版本…" : "应用这项替换"}</button><button type="button" onClick={onCancelPreview} disabled={busy !== null} className="min-h-12 rounded-md border border-sand bg-white px-3 py-3 font-medium text-graphite hover:border-sage disabled:opacity-50">取消预览</button></div> : isAlternative ? <button type="button" onClick={() => onAction("preview", selectedId!)} disabled={!canReplace || busy !== null || selectedCard?.eligibility === "excluded"} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-sage px-4 py-3 font-semibold text-white hover:bg-focus disabled:cursor-not-allowed disabled:bg-graphite/50"><RefreshCw aria-hidden="true" className={`size-5 ${busy === "preview" ? "animate-spin" : ""}`} />{busy === "preview" ? "正在检查时间、路线和费用…" : "预览替换这项安排"}</button> : <button type="button" onClick={() => onAction("keep")} disabled={!data || busy !== null || currentConflict} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-sage bg-white px-4 py-3 font-semibold text-sage hover:bg-sage-soft disabled:cursor-not-allowed disabled:opacity-50"><Check aria-hidden="true" className="size-5" />{busy === "keep" ? "正在保留…" : "保留当前景点"}</button>}
        <p className="text-sm leading-6 text-graphite">{saving ? "正在保存计划，完成后可关闭。" : currentConflict ? "该景点存在明确冲突，请查看原因并选择其他候选。" : preview ? "请核对变化与待确认事项；应用后保存新的计划版本。" : isAlternative ? "替换只调整这一项；预约与营业未知仍需确认。" : "保留记录你的选择，不代表已预约或核验营业状态。"}</p>
      </footer>
    </div>
  </dialog>;
}

export function AttractionTimelineCard({ tripId, plan, event, visitLabel, onSaved, onMap, compact = false }: {
  tripId: string; plan: PlanVersionClient; event: PlanEvent; visitLabel: string; onSaved: (plan: PlanVersionClient) => void; onMap: () => void; compact?: boolean;
}) {
  const [data, setData] = useState<AttractionRecommendations | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<Action | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [preview, setPreview] = useState<AttractionReplacementPreview | null>(null);
  const scope = `${tripId}/${plan.id}/${event.id}`;
  const activeScope = useRef<string | null>(scope);
  const requestRef = useRef<AbortController | null>(null);
  const endpoint = `/api/trips/${tripId}/plans/${plan.versionNumber}/attractions`;

  useEffect(() => {
    activeScope.current = scope;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setData(null);
    setPreview(null);
    setBusy(null);
    setFeedback(null);
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const active = () => activeScope.current === scope && requestRef.current === controller;
    void (async () => {
      try {
        const response = await businessFetch(`${endpoint}?eventId=${encodeURIComponent(event.id)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as { recommendations?: AttractionRecommendations; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? `景点资料读取失败（HTTP ${response.status}）。`);
        if (!active() || controller.signal.aborted) return;
        if (payload?.recommendations?.planVersionId !== plan.id || payload.recommendations.eventId !== event.id) throw new Error("资料所属计划已变化或返回不完整，请重新读取当前景点。");
        setData(payload.recommendations);
      } catch (error) {
        if (!active()) return;
        setFeedback({ error: true, message: controller.signal.aborted ? "景点资料读取超时，请重试。" : error instanceof Error ? error.message : "暂时无法读取景点资料，请重试。" });
      } finally {
        window.clearTimeout(timeout);
        if (active()) setLoading(false);
      }
    })();
    return () => {
      activeScope.current = null;
      window.clearTimeout(timeout);
      requestRef.current?.abort();
    };
  }, [scope, endpoint, event.id, plan.id, plan.isCurrent, retry]);

  const performAction = async (action: Action, candidateId?: string) => {
    if (busy || !data || !plan.isCurrent || data.readOnly || (action !== "keep" && !data.canReplace)) return;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    const currentRequest = () => activeScope.current === scope && requestRef.current === controller;
    const active = () => currentRequest() && !controller.signal.aborted;
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, action === "preview" ? 60_000 : 30_000);
    setBusy(action);
    setFeedback({ error: false, message: action === "preview" ? "正在按本版行程检查替换后的衔接…" : "正在保存你的选择…" });
    if (action === "preview") setPreview(null);
    try {
      const response = await businessFetch(endpoint, { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, eventId: event.id, ...(candidateId ? { candidateId } : {}), ...(action === "apply" && preview ? { previewToken: preview.previewToken } : {}) }) });
      const payload = await response.json().catch(() => null) as { preview?: AttractionReplacementPreview; plan?: PlanVersionClient; error?: string } | null;
      if (!active()) return;
      if (!response.ok) throw new Error(payload?.error ?? `操作失败（HTTP ${response.status}），当前安排保持不变。`);
      if (action === "preview") {
        if (!payload?.preview || payload.preview.eventId !== event.id || payload.preview.candidateId !== candidateId) throw new Error("预览所属景点已变化或返回不完整，请重新选择候选。");
        setPreview(payload.preview);
        setFeedback({ error: false, message: payload.preview.canApply ? "替换预览已就绪，请查看变化与仍需确认的资料。" : "这项替换存在冲突，请查看预览说明。" });
      } else {
        if (!payload?.plan || payload.plan.tripId !== tripId || (action === "apply" && payload.plan.id === plan.id) || !payload.plan.isCurrent) throw new Error("保存结果身份异常，请刷新计划后核对。");
        setOpen(false);
        onSaved(payload.plan);
      }
    } catch (error) {
      if (currentRequest() && (timedOut || !controller.signal.aborted)) setFeedback({ error: true, message: timedOut
        ? action === "preview" ? "替换预览超时，可以重试；当前计划未改变。" : "尚未收到保存结果，请刷新计划核对后再试。"
        : error instanceof Error ? error.message : "操作失败，请稍后重试。" });
    } finally {
      window.clearTimeout(timeout);
      if (currentRequest()) setBusy(null);
    }
  };

  const close = () => {
    if (busy === "apply" || busy === "keep") return;
    if (busy === "preview") { requestRef.current?.abort(); setBusy(null); setFeedback(null); }
    setPreview(null);
    setOpen(false);
  };
  const photo = data?.current?.images.find((item) => item.entryId === data.current?.id && item.entityName === data.current?.name && item.displayAllowed) ?? null;

  return <>
    {compact ? <div className={styles.recommendationCompact}>
      <button type="button" onClick={() => setOpen(true)} aria-label={`查看景点详情：${event.title}`} aria-haspopup="dialog" title="查看景点与候选" className={styles.compactLink}><ChevronRight aria-hidden="true" className="size-3.5" /></button>
      <button type="button" onClick={onMap} aria-label={`定位地图：${visitLabel}${event.title}`} title="地图与详情" className={styles.compactLink}><MapPin aria-hidden="true" className="size-3.5" /></button>
    </div> : <div className={styles.recommendation}>
      <Photo key={photo?.id ?? "missing"} photo={photo} compact />
      <div className={styles.recommendationBody}>
        {data?.current?.reasons[0] ? <p>{data.current.reasons[0]}</p> : null}
        <div className={styles.recommendationActions}>
          <button type="button" onClick={() => setOpen(true)} aria-label={`查看景点详情：${event.title}`} aria-haspopup="dialog" className={styles.recommendationLink}>查看景点与候选<ChevronRight aria-hidden="true" className="size-4" /></button>
          <button type="button" onClick={onMap} aria-label={`定位地图：${visitLabel}${event.title}`} className={styles.mapLink}><MapPin aria-hidden="true" className="size-4" />地图与详情</button>
        </div>
      </div>
    </div>}
    {open ? <AttractionDrawer event={event} visitLabel={visitLabel} data={data} loading={loading} feedback={feedback} busy={busy} preview={preview}
      onRetry={() => setRetry((value) => value + 1)} onAction={(action, candidateId) => void performAction(action, candidateId)}
      onCancelPreview={() => { setPreview(null); setFeedback(null); }} onClose={close} /> : null}
  </>;
}
