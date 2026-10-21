"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CloudSun, RefreshCw } from "lucide-react";
import { advisoryCategoryLabels, advisorySeverityLabels, advisoryValidityLabels, type AdvisoryView, type AdvisoryItem } from "@/lib/advisories";
import { effectiveWeatherStatus, weatherSummary } from "@/lib/weather";
import type { PlanVersionClient } from "./plan-overview";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sand bg-white px-3 py-2 text-sm font-semibold text-sage hover:bg-sage-soft disabled:opacity-50";
const linkAction = "inline-flex min-h-8 items-center rounded text-xs font-medium text-sage underline decoration-sage/40 underline-offset-4 hover:text-focus disabled:cursor-not-allowed disabled:text-graphite/60";
const time = (date: string) => new Date(date).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const sourceUrl = (url: string | null) => { try { const parsed = new URL(url ?? ""); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; } };

export function useAdvisories(tripId: string, plan: PlanVersionClient | null) {
  const [view, setView] = useState<AdvisoryView | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null), lock = useRef(false);
  const version = plan?.versionNumber, isCurrent = plan?.isCurrent;
  const request = useCallback(async (body?: object, quiet = false) => {
    if (lock.current || !version || !isCurrent) return;
    lock.current = true; setBusy(true); if (!quiet) { setError(""); setMessage(body ? "正在更新提醒…" : "正在读取提醒…"); }
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 50_000);
    try {
      const response = await businessFetch(`/api/trips/${tripId}/advisories${body ? "" : `?planVersion=${version}`}`, {
        method: body ? "POST" : "GET", cache: "no-store", signal: abort.signal,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "提醒暂不可用。");
      if (controller.current !== abort) return;
      setView(payload.advisories); setError("");
      if (!quiet) setMessage(body ? "提醒已保存；已知标记仅表示你已了解，不改变行程或办理结果。" : "已读取当前提醒。");
    } catch (e) {
      if (controller.current === abort) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "未收到操作结果，请重新读取核对是否已保存。");
    } finally { window.clearTimeout(timeout); if (controller.current === abort) { controller.current = null; lock.current = false; setBusy(false); } }
  }, [tripId, version, isCurrent]);
  useEffect(() => {
    setView(null); setError(""); setMessage(""); void request();
    const reload = () => { void request(undefined, true); };
    const interval = window.setInterval(reload, 60_000);
    window.addEventListener("focus", reload); window.addEventListener("serendipity:advisories-changed", reload);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", reload); window.removeEventListener("serendipity:advisories-changed", reload); const active = controller.current; controller.current = null; active?.abort(); lock.current = false; };
  }, [request]);
  // Time advances even when a read fails: never keep an expired forecast badge.
  const visible = view && view.planVersion === version && isCurrent ? { ...view,
    weather: view.weather.map((w) => ({ ...w, status: effectiveWeatherStatus(w) })),
    items: view.items.filter((i) => i.category !== "weather" || i.retrievedAt && effectiveWeatherStatus({ status: "fresh", date: i.date, retrievedAt: i.retrievedAt }) === "fresh") } : null;
  return { view: visible, busy, error, message, load: () => request(),
    refresh: () => view && request({ action: "refresh", expectedPlanVersion: version, expectedRevision: view.revision }),
    acknowledge: (item: AdvisoryItem) => view && request({ action: "acknowledge", expectedPlanVersion: version, expectedRevision: view.revision, advisoryId: item.id, signature: item.signature, acknowledged: !item.acknowledged }) };
}
export type AdvisoryController = ReturnType<typeof useAdvisories>;

export function AdvisorySummary({ data, onOpen }: { data: AdvisoryController; onOpen: () => void }) {
  const active = data.view?.items.filter((i) => !i.acknowledged || i.severity === "action") ?? [];
  return <section className="mt-4 rounded-md border border-sand bg-cream p-4" aria-label="行程关键提醒">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold text-charcoal"><Bell className="size-4 text-sage" aria-hidden="true" />行程提醒{data.view ? ` · ${active.length} 项需留意` : ""}</h3><button type="button" className={button} onClick={onOpen}>查看行程提醒</button></div>
    {active.length ? <ul className="mt-2 space-y-1 text-sm leading-6 text-graphite">{active.slice(0, 3).map((i) => <li key={i.id}>{i.date} · {i.targetName}：{i.title}{i.acknowledged ? "（已知，限制仍适用）" : ""}</li>)}</ul> : <p className="mt-2 text-sm leading-6 text-graphite">{data.error || (data.view ? "暂未发现需处理的条件提醒；尚未查询的天气与来源仍需确认。" : "正在读取与本次行程有关的提醒…")}</p>}
  </section>;
}

export function AdvisoryPanel({ data, plan, onEvent, onChecklist }: { data: AdvisoryController; plan: PlanVersionClient; onEvent: (id: string, target: "timeline" | "transport" | "map", day: number) => void; onChecklist: (id: string) => void }) {
  const [showKnown, setShowKnown] = useState(false);
  if (!plan.isCurrent) return <div className="mt-4 rounded-md bg-cream p-5"><p>这里是历史计划，当前提醒不作为历史快照展示。</p><Link href={`/trips/${plan.tripId}?view=advisories`} className={button + " mt-3"}>返回当前行程提醒</Link></div>;
  const items = data.view?.items.filter((i) => showKnown || !i.acknowledged || i.severity === "action") ?? [];
  return <section className="mt-4 space-y-4" aria-label="行程相关提醒">
    <div className="rounded-lg border border-sand bg-cream p-5"><h3 className="text-2xl font-bold text-charcoal">为这趟旅行多留意一步</h3><p className="mt-2 text-sm leading-6 text-graphite">提醒关联本计划的活动和准备事项。标记已知仅表示已了解；天气仍是预报，关闭限制仍需处理。</p>
      <div className="mt-4 flex flex-wrap gap-2"><button className={button} type="button" disabled={data.busy || !data.view} onClick={() => void data.refresh()}><RefreshCw className="size-4" aria-hidden="true" />刷新天气与提醒</button><button className={button} type="button" disabled={data.busy} onClick={() => void data.load()}>重新读取提醒</button><Link href="/settings#weather-settings" className={button}>天气设置</Link></div>
      <p className="mt-2 text-xs leading-5 text-graphite">天气按活动地点查询，最多未来16天；超过1小时需刷新。其他开放、预约来源请在相关活动的“来源”入口刷新。</p>
      <p role="status" className="mt-3 text-sm leading-6 text-graphite">{data.busy ? "正在处理…" : data.message}</p>{data.error && <p role="alert" className="mt-2 rounded bg-clay-soft p-3 text-sm text-clay">{data.error}</p>}
    </div>
    <details open className="rounded-md border border-sand p-4"><summary className="min-h-11 cursor-pointer font-semibold text-charcoal"><CloudSun aria-hidden="true" className="mr-2 inline size-5 text-sage" />活动所在地的天气</summary>
      <div className="grid gap-3 md:grid-cols-2">{data.view?.weather.map((w) => <div key={w.id} className="rounded bg-shell p-3 text-sm leading-6"><p className="font-semibold">{w.date} · {w.locationName}地区</p><p>{weatherSummary(w)}</p><p className="text-xs text-graphite">{w.retrievedAt ? `获取于 ${time(w.retrievedAt)}（北京时间）` : "尚无有效获取时间"}</p><a className="text-sage underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo 预报来源</a></div>)}</div>
      {!data.view?.weather.length && <p className="text-sm text-graphite">尚无可展示的天气资料。</p>}
      {!!data.view?.missingWeatherEventIds.length && <details className="mt-3 text-sm text-graphite"><summary className="min-h-11 cursor-pointer">{data.view.missingWeatherEventIds.length} 项活动缺少位置，天气未知</summary><div className="flex flex-wrap gap-2">{data.view.missingWeatherEventIds.map((id) => { const e = plan.events.find((e) => e.id === id)!; return <button key={id} type="button" className={button} onClick={() => onEvent(id, "map", e.dayNumber)}>定位：{e.title}</button>; })}</div></details>}
    </details>
    <label className="flex min-h-11 items-center gap-3 text-sm text-graphite"><input type="checkbox" checked={showKnown} onChange={(e) => setShowKnown(e.target.checked)} className="size-5 accent-sage" />显示已知事项（需处理的限制始终显示）</label>
    {!items.length && data.view && <p className="rounded bg-shell p-4 text-sm text-graphite">当前没有未读的相关提醒。没有提醒不代表所有来源已核验。</p>}
    {items.map((item) => {
      const relatedEvents = item.eventIds.map((id) => {
        const event = plan.events.find((e) => e.id === id);
        return event ? <button key={id} type="button" className={linkAction} onClick={() => onEvent(id, "timeline", event.dayNumber)}>相关活动{item.eventIds.length > 1 ? ` · ${event.title}` : ""}</button> : null;
      });
      return <article key={item.id} id={`advisory-${item.id}`} data-advisory-id={item.id} className={`rounded-lg border p-4 ${item.severity === "action" ? "border-clay bg-clay-soft/40" : "border-sand bg-white"}`}>
      <p className="text-xs font-semibold text-sage">{item.date} · {advisoryCategoryLabels[item.category]} · {advisorySeverityLabels[item.severity]} · {advisoryValidityLabels[item.validity]}{item.acknowledged ? " · 已知事项" : ""}</p><h4 className="mt-2 text-lg font-semibold text-charcoal">{item.title}</h4><p className="mt-1 break-words text-sm font-semibold text-charcoal">关联：{item.targetName}</p><p className="mt-2 text-sm leading-6 text-graphite">{item.recommendation}</p>
      <details className="mt-3 text-sm leading-6 text-graphite">
        <summary className="min-h-11 cursor-pointer font-medium text-sage">展开依据与来源</summary>
        <p className="whitespace-pre-wrap break-words">触发原因：{item.reason}</p>
        {item.retrievedAt ? (
          <>
            <p className="mt-2">来源：{item.sourceLabel}</p>
            <p>{`获取 / 记录于 ${time(item.retrievedAt)}（北京时间）`}</p>
            <p>{item.applicableFrom && item.applicableUntil ? `适用：${time(item.applicableFrom)} 至 ${time(item.applicableUntil)}（北京时间）` : `关联行程日期：${item.date}；来源有效窗口待确认`}</p>
          </>
        ) : null}
        {sourceUrl(item.sourceUrl) && <a href={sourceUrl(item.sourceUrl)!} target="_blank" rel="noreferrer" className="text-sage underline">打开来源资料</a>}
        {item.aiExplanation && <p className="mt-2 rounded bg-shell p-2">AI 补充说明（非事实核验）：{item.aiExplanation}</p>}
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">{relatedEvents}{item.checklistItemId && <button className={linkAction} type="button" onClick={() => onChecklist(item.checklistItemId!)}>关联清单</button>}<button type="button" className={linkAction} disabled={data.busy} onClick={() => void data.acknowledge(item)}>{item.acknowledged ? "恢复提醒" : "标记已知"}</button></div>
    </article>;
    })}
  </section>;
}
