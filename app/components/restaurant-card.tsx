"use client";

import { BookOpenCheck, Check, ChevronRight, CircleAlert, RefreshCw, Route, Utensils, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMoneyRange } from "@/lib/budget";
import type { PlanEvent } from "@/lib/plan";
import type { MealPricing, RestaurantCard, RestaurantPreview, RestaurantRecommendations } from "@/lib/restaurants";
import type { PlanVersionClient } from "./plan-overview";
import { dateLabel, FactBox, Gallery, Photo, SourceLink } from "./recommendation-ui";
import { RouteSummary } from "./route-summary";

type Feedback = { error: boolean; message: string };
type Action = "preview" | "apply";
const money = (value: number | null) => value === null ? "" : String(value / 100);
function parseMoney(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()) || Number(value) > 20_000_000) throw new Error("人均金额须为非负金额，最多两位小数。");
  const [yuan, cents = ""] = value.trim().split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
}

function RestaurantDetails({ card }: { card: RestaurantCard }) {
  return <div className="space-y-5">
    <div className="text-sm leading-6 text-graphite"><p>{card.description}</p><p className="mt-2">门店地址：{card.address}</p></div>
    <section className="rounded-md bg-sage-soft p-4">
      <h3 className="flex items-center gap-2 font-semibold text-charcoal"><Utensils aria-hidden="true" className="size-5 text-sage" />为什么适合这顿饭</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-charcoal">{card.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
    </section>
    <dl className="grid gap-3 sm:grid-cols-2">
      <FactBox title="菜品" fact={card.dishes} sources={card.sources} />
      <FactBox title="人均参考" fact={card.price} sources={card.sources}><p className="font-semibold text-charcoal">{formatMoneyRange(card.price.minCents, card.price.maxCents)} / 人 / 餐</p></FactBox>
      <FactBox title="营业资料" fact={card.opening} sources={card.sources} />
      <div className="rounded-md border border-sand bg-white p-4"><dt className="font-semibold">人数适配</dt><dd className="mt-2 text-sm leading-6 text-graphite">{card.diningFit}</dd></div>
      <div className="rounded-md border border-sand bg-white p-4"><dt className="font-semibold">排队信息</dt><dd className="mt-2 text-sm leading-6 text-graphite">{card.queueText}<p>不以热度推算等位时长；用餐时长不含排队。</p></dd></div>
      <div className="rounded-md border border-sand bg-white p-4"><dt className="font-semibold">用餐时长</dt><dd className="mt-2 text-sm leading-6 text-graphite">{card.diningMinutes.min}–{card.diningMinutes.max} 分钟 · 规则估算<p>第 {card.dayNumber} 天 · {card.date}</p></dd></div>
    </dl>
    <section aria-label="用餐前后站衔接" className="rounded-md border border-sand bg-white p-4">
      <h3 className="flex items-center gap-2 font-semibold"><Route aria-hidden="true" className="size-5 text-sage" />吃完后怎么去下一站</h3>
      <div className="mt-3 space-y-4 text-sm leading-6 text-graphite">
        <div><p className="font-medium text-charcoal">上一站：{card.previousStop ?? "当天首站"}</p>{card.incomingRoute ? <RouteSummary route={card.incomingRoute} /> : <p>距离、交通方式与耗时未知，请在地图中补查。</p>}</div>
        <div><p className="font-medium text-charcoal">下一站：{card.nextStop ?? "当天末站"}</p>{card.outgoingRoute ? <RouteSummary route={card.outgoingRoute} /> : <p>{card.nextStop ? "距离、交通方式与耗时未知，替换时检查已有路线；无路线时需补查。" : "当天没有后续安排。"}</p>}</div>
      </div>
    </section>
    {card.warnings.length ? <section className="rounded-md bg-clay-soft p-4 text-sm leading-6 text-clay"><h3 className="flex items-center gap-2 font-semibold"><CircleAlert aria-hidden="true" className="size-5" />用餐前需核对</h3><ul className="mt-2 list-disc space-y-1 pl-5">{card.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></section> : null}
    <details className="rounded-md border border-sand bg-white p-4"><summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-sage"><BookOpenCheck aria-hidden="true" className="size-5" />全部餐厅来源（{card.sources.length}）</summary><ul className="mt-3 space-y-3">{card.sources.map((source) => <li key={source.id} className="text-sm leading-6 text-graphite"><SourceLink source={source} /><p>{source.publisher} · 查阅于 {dateLabel(source.retrievedAt)}</p><blockquote className="border-l-2 border-sand pl-3">{source.quote}</blockquote></li>)}</ul></details>
  </div>;
}

function MealDrawer({ event, visitLabel, data, loading, feedback, busy, preview, onRetry, onAction, onCancelPreview, onClose }: {
  event: PlanEvent; visitLabel: string; data: RestaurantRecommendations | null; loading: boolean; feedback: Feedback | null;
  busy: Action | null; preview: RestaurantPreview | null; onRetry: () => void;
  onAction: (action: Action, candidateId: string | null, pricing?: MealPricing) => void; onCancelPreview: () => void; onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null), closeRef = useRef<HTMLButtonElement>(null), previewRef = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [alternatives, setAlternatives] = useState(false);
  const [diners, setDiners] = useState(String(data?.pricing.dinerCount ?? 1));
  const [min, setMin] = useState(money(data?.pricing.minCents ?? null)), [max, setMax] = useState(money(data?.pricing.maxCents ?? null));
  const [inputError, setInputError] = useState<string | null>(null);
  const selected = selectedId ? data?.candidates.find((card) => card.id === selectedId) ?? null : data?.current ?? null;
  const saving = busy === "apply", editable = data?.canEdit && !data.readOnly;
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; dialog?.showModal(); closeRef.current?.focus();
    return () => { dialog?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (data) { setDiners(String(data.pricing.dinerCount)); setMin(money(data.pricing.minCents)); setMax(money(data.pricing.maxCents)); } }, [data]);
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: "start" }); }, [preview]);
  const choose = (id: string | null) => {
    const card = id ? data?.candidates.find((item) => item.id === id) : null;
    setSelectedId(id); setMin(money(id ? card?.price.minCents ?? null : data?.pricing.minCents ?? null)); setMax(money(id ? card?.price.maxCents ?? null : data?.pricing.maxCents ?? null)); setInputError(null); onCancelPreview();
  };
  const submit = () => {
    try {
      const dinerCount = Number(diners), minCents = parseMoney(min), maxCents = parseMoney(max);
      if (!Number.isInteger(dinerCount) || dinerCount < 1 || dinerCount > 100) throw new Error("本餐人数须为 1 到 100 的整数。");
      if (maxCents !== null && (minCents === null || maxCents < minCents)) throw new Error("请先填写人均下限，上限不能低于下限。");
      setInputError(null); onAction("preview", selectedId, { dinerCount, minCents, maxCents });
    } catch (error) { setInputError(error instanceof Error ? error.message : "请核对输入。"); }
  };
  let estimate = "待确认";
  try { const lower = parseMoney(min), upper = parseMoney(max); if (Number.isInteger(Number(diners)) && Number(diners) > 0) estimate = formatMoneyRange(lower === null ? null : lower * Number(diners), lower === null ? null : (upper ?? lower) * Number(diners)); } catch { /* Validation is shown on preview. */ }

  return <dialog ref={dialogRef} aria-labelledby="restaurant-drawer-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }} className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-charcoal backdrop:bg-charcoal/40">
    <div className="ml-auto flex h-full w-full max-w-2xl flex-col bg-cream shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sand px-4 py-4 sm:px-6"><div className="min-w-0"><p className="text-sm font-medium text-sage">餐厅小档案 · 第 {event.dayNumber} 天 · {visitLabel}</p><h2 id="restaurant-drawer-title" className="mt-1 break-words text-xl font-bold">{selected?.name ?? event.title}</h2><p className="mt-1 text-sm text-graphite">{event.date} · {event.startTime}–{event.endTime} · {selectedId ? "替换候选" : "当前用餐"}{data?.readOnly ? " · 历史版本只读" : ""}</p></div><button ref={closeRef} type="button" onClick={onClose} disabled={saving} aria-label="关闭餐厅详情" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-sand bg-white disabled:opacity-50"><X aria-hidden="true" className="size-5" /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        {loading ? <p role="status" className="rounded-md bg-shell p-4 text-sm">正在读取菜品、营业和用餐资料…</p> : null}
        {feedback ? <div role={feedback.error ? "alert" : "status"} className={`rounded-md p-4 text-sm leading-6 ${feedback.error ? "bg-clay-soft text-clay" : "bg-sage-soft text-sage"}`}><p>{feedback.message}</p>{feedback.error && !data ? <button onClick={onRetry} disabled={loading} className="mt-2 min-h-11 rounded-md border border-clay px-3 font-semibold">重试读取</button> : null}</div> : null}
        {selected ? <Gallery key={selected.id} card={selected} /> : null}
        {data ? <>
          <div className="rounded-md border border-sand p-4 text-sm leading-6 text-graphite">{[...data.protectionReasons, ...data.notices].map((notice, index) => <p key={index}>{notice}</p>)}</div>
          <section aria-label="餐厅候选" className="space-y-3"><div className="flex flex-wrap gap-2">{selectedId ? <button onClick={() => choose(null)} disabled={busy !== null} className="min-h-11 rounded-md border border-sage bg-white px-3 text-sm font-semibold text-sage">返回当前用餐</button> : null}<button onClick={() => setAlternatives(!alternatives)} aria-expanded={alternatives} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sand bg-white px-3 text-sm font-semibold">{alternatives ? "收起" : "查看"}餐厅候选（{data.candidates.length}）<ChevronRight aria-hidden="true" className="size-4" /></button></div>
            {alternatives ? <div className="space-y-2">{data.candidates.length ? data.candidates.map((card) => <button key={card.id} onClick={() => choose(card.id)} disabled={busy !== null} aria-pressed={selectedId === card.id} className={`min-h-20 w-full rounded-md border p-3 text-left disabled:opacity-50 ${selectedId === card.id ? "border-sage bg-sage-soft" : "border-sand bg-white"}`}><span className="block font-semibold">{card.name}</span><span className="mt-1 block text-sm leading-6 text-graphite">{formatMoneyRange(card.price.minCents, card.price.maxCents)} / 人 · {card.service === "individual" ? "可按碗点餐" : card.service === "small_plates" ? "可比较小份小吃" : "人数接待待确认"}</span><span className="block text-sm leading-6 text-graphite">{card.opening.text}</span></button>) : <p className="rounded-md bg-shell p-3 text-sm">当前没有合适的其他候选；门店资料无结果时仍可记录本餐预算。</p>}</div> : null}
            {data.excluded.length ? <details className="text-sm leading-6 text-graphite"><summary className="min-h-11 cursor-pointer py-3">为什么有 {data.excluded.length} 家未入选</summary>{data.excluded.map((item) => <p key={item.id}>{item.name}：{item.reasons.join("；")}</p>)}</details> : null}
          </section>
          <fieldset disabled={!editable || busy !== null || preview !== null} className="space-y-3 rounded-md border border-sand bg-white p-4 disabled:opacity-70"><legend className="px-1 font-semibold">本餐人数与预算估算</legend><p className="text-sm leading-6 text-graphite">原计划本餐合计：{formatMoneyRange(data.currentMealTotal.minCents, data.currentMealTotal.maxCents)}。人均留空表示未知；填写后先预览再保存。</p><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium">本餐人数<input type="number" min="1" max="100" step="1" value={diners} onChange={(event) => setDiners(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-sand px-3" /></label><label className="text-sm font-medium">人均下限（元）<input inputMode="decimal" value={min} placeholder="未知" onChange={(event) => setMin(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-sand px-3" /></label><label className="text-sm font-medium">人均上限（元，可空）<input inputMode="decimal" value={max} placeholder="与下限相同" onChange={(event) => setMax(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-sand px-3" /></label></div><p className="text-sm font-semibold text-sage" aria-live="polite">本餐预计合计：{estimate} · {diners || "待填"} 人 × 1 餐</p><p className="text-sm leading-6 text-graphite">修改人数后，预览会重新检查人数适配、预算和衔接。已确认或支付的金额请从预算入口处理。</p></fieldset>
        </> : null}
        {inputError ? <p role="alert" className="rounded-md bg-clay-soft p-3 text-sm text-clay">{inputError}</p> : null}
        {preview ? <section ref={previewRef} aria-label="用餐调整预览" className="space-y-3 rounded-md border-2 border-sage bg-white p-4"><h3 className="text-lg font-semibold">用餐调整预览</h3><ul className="list-disc space-y-2 pl-5 text-sm leading-6">{preview.changes.map((change, index) => <li key={index}>{change}</li>)}</ul><div className="rounded-md bg-shell p-3 text-sm leading-6"><p>调整前全程预算：{formatMoneyRange(preview.beforeBudget.totalMinCents, preview.beforeBudget.totalMaxCents)}（另有 {preview.beforeBudget.unknownItemCount} 项未知）</p><p>调整后全程预算：{formatMoneyRange(preview.afterBudget.totalMinCents, preview.afterBudget.totalMaxCents)}（另有 {preview.afterBudget.unknownItemCount} 项未知）</p></div>{preview.conflicts.length ? <div role="alert" className="rounded-md bg-clay-soft p-3 text-sm leading-6 text-clay"><p className="font-semibold">存在冲突，不能应用</p>{preview.conflicts.map((message, index) => <p key={index}>{message}</p>)}</div> : null}<details><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-sage">仍需确认（{preview.warnings.length}）</summary><ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-graphite">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details></section> : null}
        {selected ? <RestaurantDetails key={selected.id} card={preview?.card ?? selected} /> : data ? <div className="space-y-3"><Photo photo={null} /><p className="rounded-md bg-white p-4 text-sm leading-6 text-graphite">还没有与“{data.eventName}”准确对应的门店资料。菜品、人均、营业、排队与搬迁状态待确认；不会借用同品牌其他门店的照片。</p></div> : null}
      </div>
      <footer className="shrink-0 space-y-2 border-t border-sand bg-cream px-4 py-3 sm:px-6">{data?.readOnly ? <p className="py-2 text-sm">历史版本只读，请回到当前计划操作。</p> : preview ? <div className="flex gap-3"><button onClick={() => onAction("apply", selectedId)} disabled={!editable || busy !== null || !preview.canApply} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-sage px-3 font-semibold text-white disabled:bg-graphite/50"><Check aria-hidden="true" className="size-5" />{saving ? "正在保存新版本…" : "应用用餐调整"}</button><button onClick={onCancelPreview} disabled={busy !== null} className="min-h-12 rounded-md border border-sand bg-white px-3">取消预览</button></div> : <button onClick={submit} disabled={!editable || busy !== null || (!selectedId && data?.current?.eligibility === "excluded")} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-sage px-3 font-semibold text-white disabled:bg-graphite/50"><RefreshCw aria-hidden="true" className={`size-5 ${busy ? "animate-spin" : ""}`} />{busy ? "正在检查营业、路线和费用…" : selectedId ? "预览替换餐厅" : "预览本餐人数与预算"}</button>}<p className="text-sm leading-6 text-graphite">{saving ? "正在保存计划，完成后可关闭。" : "应用后保存新的计划版本；未订餐，排队和有座情况未知。"}</p></footer>
    </div>
  </dialog>;
}

export function RestaurantTimelineCard({ tripId, plan, event, visitLabel, onSaved }: { tripId: string; plan: PlanVersionClient; event: PlanEvent; visitLabel: string; onSaved: (plan: PlanVersionClient) => void }) {
  const [data, setData] = useState<RestaurantRecommendations | null>(null), [loading, setLoading] = useState(true), [open, setOpen] = useState(false), [retry, setRetry] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null), [busy, setBusy] = useState<Action | null>(null), [preview, setPreview] = useState<RestaurantPreview | null>(null);
  const scope = `${tripId}/${plan.id}/${event.id}`, endpoint = `/api/trips/${tripId}/plans/${plan.versionNumber}/restaurants`;
  const activeScope = useRef<string | null>(scope), requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    activeScope.current = scope; const controller = new AbortController(); requestRef.current = controller;
    setData(null); setLoading(true); setFeedback(null); setPreview(null); setBusy(null);
    const current = () => activeScope.current === scope && requestRef.current === controller;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    void (async () => {
      try {
        const response = await fetch(`${endpoint}?eventId=${encodeURIComponent(event.id)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!current() || controller.signal.aborted) return;
        if (!response.ok) throw new Error(payload?.error ?? "餐厅资料读取失败，请重试。");
        if (payload?.recommendations?.planVersionId !== plan.id || payload.recommendations.eventId !== event.id) throw new Error("资料所属计划已变化，请重新读取。");
        setData(payload.recommendations);
      } catch (error) { if (current()) setFeedback({ error: true, message: controller.signal.aborted ? "餐厅资料读取超时，请重试。" : error instanceof Error ? error.message : "餐厅资料读取失败，请重试。" }); }
      finally { window.clearTimeout(timeout); if (current()) setLoading(false); }
    })();
    return () => { activeScope.current = null; window.clearTimeout(timeout); requestRef.current?.abort(); };
  }, [scope, endpoint, plan.id, plan.isCurrent, event.id, retry]);
  const perform = async (action: Action, candidateId: string | null, pricing?: MealPricing) => {
    if (busy || !data?.canEdit || !plan.isCurrent || (action === "apply" && !preview)) return;
    const controller = new AbortController(); requestRef.current?.abort(); requestRef.current = controller;
    const current = () => activeScope.current === scope && requestRef.current === controller;
    let timedOut = false; const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, action === "preview" ? 60_000 : 30_000);
    setBusy(action); setFeedback({ error: false, message: action === "preview" ? "正在检查本餐调整…" : "正在保存用餐安排…" });
    if (action === "preview") setPreview(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify(action === "preview" ? { action, eventId: event.id, candidateId, pricing } : { action, eventId: event.id, previewToken: preview!.previewToken }) });
      const payload = await response.json();
      if (!current() || controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload?.error ?? "操作未完成，请重试或刷新核对。");
      if (action === "preview") {
        if (payload?.preview?.eventId !== event.id || payload.preview.candidateId !== candidateId) throw new Error("返回的用餐预览不匹配，请重新预览。");
        setPreview(payload.preview); setFeedback({ error: false, message: payload.preview.canApply ? "预览已就绪，请核对变化后应用。" : "本餐调整存在冲突，请查看原因。" });
      } else {
        if (payload?.plan?.tripId !== tripId || payload.plan.id === plan.id || !payload.plan.isCurrent) throw new Error("保存结果异常，请刷新计划核对。");
        setOpen(false); onSaved(payload.plan);
      }
    } catch (error) { if (current() && (timedOut || !controller.signal.aborted)) setFeedback({ error: true, message: timedOut ? action === "preview" ? "用餐预览超时，可以重试；当前计划未改变。" : "尚未收到保存结果，请刷新计划核对后再试。" : error instanceof Error ? error.message : "操作失败，请重试。" }); }
    finally { window.clearTimeout(timeout); if (current()) setBusy(null); }
  };
  const close = () => { if (busy === "apply") return; if (busy === "preview") { requestRef.current?.abort(); setBusy(null); setFeedback(null); } setPreview(null); setOpen(false); };
  const photo = data?.current?.images[0] ?? null;
  return <><div className="flex items-center gap-3 rounded-md border border-sand/80 bg-cream p-3 sm:gap-4"><Photo key={photo?.id ?? "missing"} photo={photo} compact /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">餐厅小档案{event.restaurantSelection ? " · 已选择" : ""}</p><p className="mt-1 text-sm leading-6 text-graphite">{loading ? "正在读取菜品与用餐资料…" : data ? `${data.pricing.dinerCount}人用餐 · 本餐合计${formatMoneyRange(data.currentMealTotal.minCents, data.currentMealTotal.maxCents)} · ${data.current?.queueText ?? "暂无可靠排队信息"}` : "资料暂时不可用，可打开后重试。"}</p><button onClick={() => setOpen(true)} aria-label={`查看餐厅详情：${event.title}`} aria-haspopup="dialog" className="mt-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-sage">查看餐厅与候选<ChevronRight aria-hidden="true" className="size-4" /></button></div></div>{open ? <MealDrawer event={event} visitLabel={visitLabel} data={data} loading={loading} feedback={feedback} busy={busy} preview={preview} onRetry={() => setRetry((value) => value + 1)} onAction={(action, candidateId, pricing) => void perform(action, candidateId, pricing)} onCancelPreview={() => { setPreview(null); setFeedback(null); }} onClose={close} /> : null}</>;
}
