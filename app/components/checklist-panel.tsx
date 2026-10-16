"use client";

import Link from "next/link";
import { CheckCheck, ExternalLink, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { checklistGroups, type ChecklistAction, type ChecklistFields, type ChecklistItem, type ChecklistView } from "@/lib/checklist";
import type { PlanVersionClient } from "./plan-overview";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-sand px-3 py-2 text-sm font-semibold text-sage hover:bg-sage-soft disabled:opacity-50";
const input = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-sand bg-white px-3 py-2 text-base text-charcoal";
const blank: ChecklistFields = { title: "", group: "essentials", note: "", date: null, eventId: null };
const displayTime = (time: string) => new Date(time).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });

export function ChecklistPanel({ tripId, plan, onEvent }: { tripId: string; plan: PlanVersionClient; onEvent: (eventId: string, target: "timeline" | "transport", dayNumber: number) => void }) {
  const [view, setView] = useState<ChecklistView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState<ChecklistAction | null>(null);
  const [editing, setEditing] = useState<{ id: string; customId: string; fields: ChecklistFields } | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);
  const lock = useRef(false), controller = useRef<AbortController | null>(null);
  const url = `/api/trips/${tripId}/checklist`;

  const load = useCallback(async () => {
    if (lock.current || !plan.isCurrent) return;
    lock.current = true; setBusy(true); setError("");
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(`${url}?planVersion=${plan.versionNumber}`, { cache: "no-store", signal: abort.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "清单读取失败，请重试。");
      if (controller.current !== abort) return;
      setView(body.checklist); setFailed(null); setMessage("已读取当前清单；未提交的表单仍保留。");
    } catch (e) { if (controller.current === abort) setError(e instanceof Error && e.name !== "AbortError" ? e.message : "清单读取超时，请重试。"); }
    finally { window.clearTimeout(timeout); if (controller.current === abort) { lock.current = false; setBusy(false); } }
  }, [plan.isCurrent, plan.versionNumber, url]);

  useEffect(() => { void load(); return () => { const pending = controller.current; controller.current = null; pending?.abort(); lock.current = false; }; }, [load]);

  async function save(change: ChecklistAction) {
    if (lock.current || !view) return;
    lock.current = true; setBusy(true); setError(""); setFailed(null); setMessage("正在保存到本机…");
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ expectedPlanVersion: plan.versionNumber, expectedRevision: view.revision, expectedBasis: view.basis, change }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "保存失败，请重新读取核对后重试。");
      if (controller.current !== abort) return;
      setView(body.checklist); setMessage(change.action === "sync" ? "已按当前计划更新；仍相关的勾选、自建和删除记录均保留。" : "已保存到本机。");
      if (change.action === "add" || change.action === "edit") setEditing(null);
    } catch (e) {
      if (controller.current !== abort) return;
      setError(e instanceof Error && e.name !== "AbortError" ? `${e.message} 若结果不确定，请先重新读取核对。` : "未收到保存结果，可能尚未保存，也可能已写入。请重新读取清单核对。");
      setFailed(change); setMessage("保存未确认；页面保留原勾选和当前输入。");
    } finally { window.clearTimeout(timeout); if (controller.current === abort) { lock.current = false; setBusy(false); } }
  }

  if (!plan.isCurrent) return <div className="mt-4 rounded-md border border-sand bg-cream p-5"><h3 className="font-semibold">清单属于当前旅行</h3><p className="mt-2 text-sm text-graphite">这里是历史计划，当前准备进度不作为历史勾选展示。</p><Link className={button + " mt-3"} href={`/trips/${tripId}?view=checklist`}>返回当前计划清单</Link></div>;
  const active = view?.items.filter((i) => !i.deleted && !i.orphaned) ?? [];
  const completed = active.filter((i) => i.completed).length;
  const archived = view?.items.filter((i) => i.deleted || i.orphaned) ?? [];

  function row(item: ChecklistItem, archivedRow = false) {
    const linked = plan.events.filter((e) => item.eventIds.includes(e.id));
    return <li key={item.id} data-checklist-id={item.id} className="rounded-lg border border-sand bg-white p-4">
      <div className="flex items-start gap-2">
        <label className="-ml-2 -mt-1 flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
          <input type="checkbox" className="size-5 accent-sage" aria-label={item.title} checked={item.completed} disabled={busy || archivedRow}
            onChange={(e) => void save({ action: "complete", id: item.id, completed: e.target.checked })} />
        </label>
        <div className="min-w-0 flex-1">
          <p className={`break-words font-semibold ${item.completed ? "text-graphite" : "text-charcoal"}`}>{item.title}</p>
          <p className="mt-1 text-xs leading-5 text-graphite">{item.date ?? "未指定日期"} · {item.custom ? "自建事项" : "行程整理"}{item.completed ? " · 用户已确认" : " · 待准备"}</p>
          {item.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-graphite">{item.note}</p>}
          <p className="mt-2 text-xs leading-5 text-graphite">{item.sourceLabel}</p>
          {item.completedAt && <p className="mt-1 text-xs text-sage">确认于 {displayTime(item.completedAt)}（北京时间）</p>}
          {item.changeNote && <p className="mt-2 rounded bg-clay-soft p-2 text-sm leading-6 text-clay">{item.changeNote}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!archivedRow && linked.map((event) => <button key={event.id} type="button" className={button} onClick={() => onEvent(event.id, "timeline", event.dayNumber)}>查看相关活动{linked.length > 1 ? ` · 第${event.dayNumber}天` : ""}</button>)}
        {!archivedRow && item.group === "transport" && linked[0] && <button type="button" className={button} onClick={() => onEvent(linked[0].id, "transport", linked[0].dayNumber)}>查看关联票据</button>}
        {!archivedRow && item.officialUrl && <a href={item.officialUrl} target="_blank" rel="noopener noreferrer" className={button}>前往官方入口<ExternalLink className="size-3" aria-hidden="true" /></a>}
        {!archivedRow && !item.officialUrl && (item.group === "reservation" || item.group === "accommodation") && <span className="self-center text-xs text-graphite">暂无已确认的官方办理入口，请向场馆或酒店核对。</span>}
        {!archivedRow && item.custom && <button type="button" disabled={busy} className={button} onClick={() => setEditing({ id: item.id, customId: "", fields: { title: item.title, group: item.group, note: item.note, date: item.date, eventId: item.eventId } })}>编辑事项</button>}
        {!item.deleted && <button type="button" disabled={busy} className={button} onClick={() => void save({ action: "delete", id: item.id })}>移出清单</button>}
        {item.deleted && <button type="button" disabled={busy} className={button} onClick={() => void save({ action: "restore", id: item.id })}>恢复事项</button>}
      </div>
    </li>;
  }

  return <section className="mt-4 space-y-4" aria-label="出发前准备清单">
    <div className="rounded-lg border border-sand bg-cream p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-sage"><CheckCheck className="size-4" aria-hidden="true" />一步步准备，安心出发</p>
      <h3 className="mt-2 text-2xl font-bold text-charcoal">出发前清单</h3>
      <p className="mt-2 text-sm leading-6 text-graphite">勾选仅表示你已自行确认，不代表系统已购票、订房或完成预约。</p>
      {view && <><p className="mt-4 text-lg font-semibold text-sage">已确认 {completed} / {active.length} 项</p><progress aria-label="准备进度" value={completed} max={Math.max(1, active.length)} className="mt-2 h-2 w-full accent-sage" /><p className="mt-2 text-xs text-graphite">计划 V{view.planVersion} · 清单修订 {view.revision}{view.updatedAt ? ` · 保存于 ${displayTime(view.updatedAt)}（北京时间）` : " · 首次勾选时保存"}</p></>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !view} className={button} onClick={() => { setEditing({ id: "", customId: crypto.randomUUID(), fields: { ...blank } }); }}><Plus className="size-4" aria-hidden="true" />添加自建事项</button>
        <button type="button" disabled={busy || !view} className={button} onClick={() => void save({ action: "sync" })}><RotateCcw className="size-4" aria-hidden="true" />按当前计划更新</button>
        <button type="button" disabled={busy} className={button} onClick={() => void load()}>{view ? "重新读取清单" : "重试读取清单"}</button>
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-sm leading-6 text-graphite">{busy ? "正在处理，请稍候…" : message}</p>
      {error && <div role="alert" className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6 text-clay"><p>{error}</p>{failed && <button className={button + " mt-2"} disabled={busy} onClick={() => void save(failed)}>重试刚才的保存</button>}</div>}
    </div>
    {editing && <form aria-label="自建事项表单" onSubmit={(e) => { e.preventDefault(); void save(editing.id ? { action: "edit", id: editing.id, fields: editing.fields } : { action: "add", id: editing.customId, fields: editing.fields }); }} className="rounded-lg border border-sage bg-sage-soft p-4">
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        <legend className="mb-3 text-lg font-semibold">{editing.id ? "编辑自建事项" : "添加自建事项"}</legend>
        <label className="block text-sm">事项名称<input required maxLength={160} value={editing.fields.title} onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, title: e.target.value } })} className={input} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">分组<select aria-label="分组" value={editing.fields.group} onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, group: e.target.value as ChecklistFields["group"] } })} className={input}>{Object.entries(checklistGroups).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="block min-w-0 text-sm">关联日期<input type="date" value={editing.fields.date ?? ""} disabled={Boolean(editing.fields.eventId)} onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, date: e.target.value || null } })} className={input} /></label></div>
        <label className="block text-sm">关联活动<select aria-label="关联活动" value={editing.fields.eventId ?? ""} onChange={(e) => { const event = plan.events.find((v) => v.id === e.target.value); setEditing({ ...editing, fields: { ...editing.fields, eventId: event?.id ?? null, date: event?.date ?? editing.fields.date } }); }} className={input}>
          <option value="">不关联活动</option>{editing.fields.eventId && !plan.events.some((e) => e.id === editing.fields.eventId) && <option value={editing.fields.eventId}>原活动已移除，请重选</option>}{plan.events.map((e) => <option key={e.id} value={e.id}>{e.date} {e.startTime} · {e.title}</option>)}
        </select></label>
        <label className="block text-sm">备注<textarea rows={3} maxLength={500} value={editing.fields.note} onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, note: e.target.value } })} className={input} /></label>
        <div className="flex flex-wrap gap-2"><button type="submit" className={button + " bg-white"}>保存事项</button><button type="button" className={button} onClick={() => setEditing(null)}>取消编辑</button></div>
      </fieldset>
    </form>}
    {view && <label className="flex min-h-11 items-center gap-2 text-sm text-graphite"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="size-5 accent-sage" />只看待准备</label>}
    {view && Object.entries(checklistGroups).map(([group, label]) => {
      const all = active.filter((i) => i.group === group), visible = all.filter((i) => !onlyPending || !i.completed);
      return <section key={group} aria-label={`${label}清单`}><h4 className="mb-3 text-lg font-semibold text-charcoal">{label}<span className="ml-2 text-sm font-normal text-graphite">{all.filter((i) => i.completed).length}/{all.length}</span></h4>
        {visible.length ? <ul className="space-y-3">{visible.map((i) => row(i))}</ul> : <p className="rounded-md border border-dashed border-sand p-4 text-sm text-graphite">{all.length ? "本组事项均已确认。" : "当前没有相关事项，可按需添加。"}</p>}</section>;
    })}
    {archived.length > 0 && <details className="rounded-md border border-sand p-4"><summary className="min-h-11 cursor-pointer font-semibold text-graphite">已移出或关联已变化（{archived.length}）</summary><p className="mb-3 text-sm leading-6 text-graphite">这些事项不计入当前准备进度。移出的事项在重新生成时也不会自动恢复。</p><ul className="space-y-3">{archived.map((i) => row(i, true))}</ul></details>}
  </section>;
}
