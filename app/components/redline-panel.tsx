"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Clock3 } from "lucide-react";
import { defaultRedlinePreferences, type RedlinePreferences } from "@/lib/redline-preferences";
import { formatRedlineTime, forwardCheck, redlineUrgency, reverseCandidate, type ForwardCheck, type RedlineResult } from "@/lib/redlines";
import type { Ticket } from "@/lib/tickets";
import type { PlanVersionClient } from "./plan-overview";

const inputStyle = "mt-1 min-h-11 w-full min-w-0 rounded-md border border-sand bg-white px-3 py-2";
const buttonStyle = "min-h-11 rounded-md border border-sage px-4 py-2 font-semibold text-sage disabled:opacity-50";
const statusText = { feasible: "按所列依据仍有余量", insufficient_margin: "已过建议出门时间，余量不足", infeasible: "按当前假定截止和预计耗时无法衔接，截止仍待核实", unknown: "当前出发是否来得及待确认" };
const deadlineStatus = { met: "有余量", insufficient_margin: "余量不足", missed: "到达或超过截止，不能判为安全可行", unknown: "待确认" };
const precisionText = { verified: "已按适用时刻复核", estimated: "估算建议", pending_confirmation: "待确认建议" };

function countdown(seconds: number) {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function CheckDetails({ check, title }: { check: ForwardCheck | null; title: string }) {
  return <div className="mt-4 rounded-md bg-shell p-3">
    <h5 className="font-semibold">{title}</h5>
    {!check ? <p className="mt-2 text-sm">缺少可用路线或截止，尚未完成复核。</p> : <>
      <p className="mt-1 text-sm">出发 {formatRedlineTime(check.departureAt)} · {statusText[check.status]}</p>
      <p className="mt-1 text-sm text-graphite">本次路线：{check.route.source}；适用窗口 {formatRedlineTime(check.route.validFrom)} 至 {formatRedlineTime(check.route.validUntil)}。</p>
      {!check.routeApplicable ? <p className="mt-1 text-sm text-clay">该路线未覆盖此出发时刻，不能平移候车时间。</p> : null}
      <ol className="mt-2 space-y-1 text-sm leading-6">{check.timeline.map((s) => <li key={s.id}>{s.label}：{formatRedlineTime(s.startAt)} → {formatRedlineTime(s.endAt)}</li>)}</ol>
      {check.routeBreakdown.length ? <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">接驳逐段时刻（总耗时内）</summary><ol>{check.routeBreakdown.map((s, i) => <li key={i}>{s.label}：{formatRedlineTime(s.startAt)} → {formatRedlineTime(s.endAt)}</li>)}</ol></details> : null}
      <ul className="mt-2 space-y-2 text-sm leading-6">{check.deadlines.map((d) => <li key={d.id}>
        <strong>{d.label}：{formatRedlineTime(d.at)}</strong> · {deadlineStatus[d.status]}{d.slackSeconds !== null ? `（余量 ${Math.round(d.slackSeconds / 60 * 10) / 10} 分钟）` : ""}
        <p className="text-graphite">{d.nature === "confirmed" ? "已确认截止" : d.nature === "assumed" ? "假定截止" : "未知截止"} · {d.source}</p>
      </li>)}</ul>
    </>}
  </div>;
}

function Preferences({ ticket, result, tripId, plan, onSaved, onDirty }: {
  ticket: Ticket; result: RedlineResult; tripId: string; plan: PlanVersionClient;
  onSaved: (plan: PlanVersionClient) => void; onDirty: (dirty: boolean) => void;
}) {
  const initial = ticket.redlinePreferences ?? defaultRedlinePreferences(ticket.bufferMinutes);
  const [draft, setDraft] = useState<RedlinePreferences>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  function update<K extends keyof RedlinePreferences>(key: K, value: RedlinePreferences[K]) {
    const next = { ...draft, [key]: value };
    setDraft(next); onDirty(JSON.stringify(next) !== JSON.stringify(initial));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_redline", ticketId: ticket.id, preferences: draft }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存失败，请重试。");
      onSaved(payload.plan);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { setSaving(false); }
  }
  // Local preview changes only explicit buffers and handling durations. Route
  // validation remains a server operation; a draft is never marked executable.
  const previewInput = { ...result.input, buffers: [
    { id: "draft", label: "调整后的总缓冲", reason: "未保存预览", seconds: draft.extraBufferSeconds + (draft.firstVisit ? 300 : 0) + (draft.slowWalking ? 300 : 0) + (draft.baggage === "checked" ? 300 : 0) },
  ], steps: result.input.steps.filter((s) => s.id !== "bag" || draft.baggage !== "none").map((s) => ({ ...s,
    seconds: s.id === "security" ? draft.securitySeconds : s.id === "gate" ? draft.gateWalkingSeconds : s.id === "checkin" ? draft.checkInSeconds : s.id === "bag" ? draft.bagDropSeconds : s.seconds })) };
  const preview = draft.baggage === initial.baggage && draft.minimumArrivalSeconds === initial.minimumArrivalSeconds ? reverseCandidate(previewInput) : null;
  const numeric: [keyof RedlinePreferences, string][] = [["securitySeconds", "排队、进站及安检（分钟）"], ["gateWalkingSeconds", "站内步行（分钟）"],
    ...(ticket.mode === "flight" ? [["checkInSeconds", "值机办理（分钟）"], ["bagDropSeconds", "托运办理（分钟）"]] as [keyof RedlinePreferences, string][] : []),
    ["extraBufferSeconds", "额外机动缓冲（分钟）"], ["minimumArrivalSeconds", "至少提前到站（分钟，可留空）"]];
  return <form onSubmit={save} className="mt-5 border-t border-sand pt-4">
    <h5 className="font-semibold">调整办理条件与缓冲</h5>
    <p className="mt-1 text-sm text-graphite">每个加量均为个人建议。至少提前到站与办理截止取更严格者，不重复追加。</p>
    <fieldset disabled={!plan.isCurrent || saving} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">行李条件<select aria-label="行李条件" className={inputStyle} value={draft.baggage} onChange={(e) => update("baggage", e.target.value as RedlinePreferences["baggage"])}>
        <option value="unknown">尚未确认</option><option value="none">轻便行李，无托运</option><option value="checked">大件行李 / 需要托运</option>
      </select></label>
      <div className="flex flex-wrap gap-4 sm:items-end">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.firstVisit} onChange={(e) => update("firstVisit", e.target.checked)} />首次到访（加 5 分钟）</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.slowWalking} onChange={(e) => update("slowWalking", e.target.checked)} />步行较慢（加 5 分钟）</label>
      </div>
      {numeric.map(([key, label]) => <label key={key} className="text-sm">{label}<input type="number" min="0" max="240" step="1" required={key !== "minimumArrivalSeconds"} className={inputStyle}
        value={draft[key] === null ? "" : Number(draft[key]) / 60} onChange={(e) => update(key, e.target.value === "" && key === "minimumArrivalSeconds" ? null : Number(e.target.value) * 60)} /></label>)}
    </fieldset>
    {dirty ? <p className="mt-3 text-sm text-clay">条件已修改，旧红线失效。{preview ? `未保存的耗时估算：${formatRedlineTime(preview, ticket.date ?? undefined)}；保存后复核适用时刻。` : "保存后重新检查所有截止与路线。"}</p> : null}
    {error ? <p role="alert" className="mt-3 text-clay">{error}</p> : null}
    {plan.isCurrent ? <button className={`${buttonStyle} mt-3`} disabled={saving || !dirty}>{saving ? "正在保存…" : "保存条件并重算"}</button> : <p className="mt-3 text-sm">历史版本只读；红线仅供查看历史依据。</p>}
  </form>;
}

export function RedlinePanel({ tripId, plan, onSaved }: { tripId: string; plan: PlanVersionClient; onSaved: (plan: PlanVersionClient) => void }) {
  const router = useRouter();
  const [results, setResults] = useState<RedlineResult[] | null>(null);
  const [error, setError] = useState("");
  const [clockMessage, setClockMessage] = useState("正在与本机服务器校时…");
  const [now, setNow] = useState<number | null>(null);
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const offset = useRef(0);
  const serial = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++serial.current;
    const sent = Date.now();
    try {
      const response = await fetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/redlines`, { cache: "no-store" });
      const payload = await response.json();
      if (sequence !== serial.current) return;
      if (!response.ok) throw new Error(payload.error || "红线计算失败。");
      if (plan.isCurrent && !payload.isCurrent) { setResults(null); setError("计划已变化，正在更新红线依据。"); router.refresh(); return; }
      offset.current = Date.parse(payload.serverNow) - (sent + Date.now()) / 2;
      setNow(Date.now() + offset.current);
      setClockMessage(Math.abs(offset.current) > 120_000 ? "设备与服务器时钟相差较大，时间不可靠；暂按服务器时间显示，请核对系统时间。" : "北京时间 · 使用本机服务器校准的时间");
      setResults(payload.redlines); setError("");
    } catch (e) {
      if (sequence !== serial.current) return;
      setResults(null); offset.current = 0;
      setClockMessage("无法校时，使用设备时间；当前路线可行性待重新确认。");
      setError(e instanceof Error ? e.message : "红线暂不可用，请重试。");
    }
  }, [tripId, plan.versionNumber, plan.isCurrent, router]);
  useEffect(() => {
    void refresh();
    const tick = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    const resume = () => { setNow(Date.now() + offset.current); if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { serial.current++; clearInterval(tick); clearInterval(poll); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [refresh]);
  return <section id="time-redlines" aria-label="时间红线" className="mt-5 rounded-xl border-2 border-clay/40 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-lg font-semibold"><Clock3 className="size-5 text-clay" />出门与返程时间红线</h3><span className="text-xs text-graphite">{clockMessage}</span></div>
    <p className="mt-2 text-sm leading-6 text-graphite">固定票面、办理截止与建议行动时间分开显示。建议不是官方最晚出门时间，也不保证赶上。</p>
    {!plan.isCurrent ? <p className="mt-2 text-sm font-semibold text-clay">历史版本只读，以下依据不代表当前出行安排。</p> : null}
    {error ? <div role="alert" className="mt-3"><p>{error}</p><button className={`${buttonStyle} mt-2`} onClick={() => void refresh()}>重试计算</button></div> : null}
    {!results && !error ? <p className="mt-3">正在按当前票据与路线重算…</p> : null}
    {results?.length === 0 ? <p className="mt-3 text-sm">暂无有效票据红线。请在门到门交通中确认票面和起点；草稿、退票与已替换票不参与硬约束。</p> : null}
    <div className="mt-3 grid gap-3">{results?.map((r) => {
      const ticket = plan.tickets?.find((t) => t.id === r.input.id);
      if (!ticket) return null;
      const dirty = dirtyIds.includes(ticket.id);
      const urgency = redlineUrgency(r.suggestedAt, now ?? Date.parse(r.calculatedAt));
      const current = r.input.route.kind === "fixed" && now !== null ? forwardCheck(r.input, new Date(now).toISOString(), r.input.route) : r.currentCheck;
      const color = dirty ? "border-sand bg-shell" : urgency.color === "red" ? "border-red-300 bg-red-50" : urgency.color === "orange" ? "border-orange-300 bg-orange-50" : urgency.color === "green" ? "border-emerald-300 bg-emerald-50" : "border-sand bg-shell";
      const hasTimedEstimate = r.input.route.kind === "timed" && !r.suggestedCheck?.routeApplicable;
      return <article key={ticket.id} aria-label={`${r.input.direction === "departure" ? "去程" : "返程"}红线 ${ticket.serviceNumber ?? "票面待补"}`} className={`min-w-0 rounded-lg border p-4 ${color}`} data-urgency={urgency.color}>
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{r.input.direction === "departure" ? "去程出门" : "返程出发"} · {ticket.serviceNumber || "票面待补"}</h4><span className="text-sm">{precisionText[r.precision]}</span></div>
        <p className="mt-2 text-xl font-semibold sm:text-2xl">{dirty ? "条件已改，旧红线失效" : `${hasTimedEstimate ? "待复核估算" : "建议最晚"} ${formatRedlineTime(r.suggestedAt, ticket.date ?? undefined)}`}</p>
        {!dirty && urgency.remainingSeconds !== null ? <p className="mt-2 font-medium">{urgency.remainingSeconds > 0 ? `距建议行动还有 ${countdown(urgency.remainingSeconds)}` : "已到或已过建议行动时间"}</p> : null}
        <p className="mt-2 break-words text-sm">{r.input.origin} → {r.input.destination} · 票面固定时刻 {formatRedlineTime(r.input.departureAt)}</p>
        {!dirty ? <p className="mt-2 text-sm font-medium">{statusText[current.status]}{r.conflicts.length ? "；行程衔接存在冲突" : ""}</p> : null}
        {r.conflicts.length ? <ul className="mt-2 text-sm text-clay">{r.conflicts.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">红线详情与计算依据</summary>
          <p className="text-sm leading-6">{r.reason} {r.necessarySeconds === null ? "必要耗时待补" : `本次候选参考必要耗时 ${r.necessarySeconds / 60} 分钟`}；机动缓冲 {r.bufferSeconds / 60} 分钟。</p>
          <ul className="mt-2 space-y-1 text-sm leading-6">{r.input.buffers.map((b) => <li key={b.id}>{b.label} {b.seconds / 60} 分钟：{b.reason}</li>)}{r.input.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          <p className="mt-3 break-words text-sm">路线依据：{r.input.route.source}。适用时刻：{formatRedlineTime(r.input.route.applicableAt)}；窗口 {formatRedlineTime(r.input.route.validFrom)} 至 {formatRedlineTime(r.input.route.validUntil)}。</p>
          <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">接驳分项（仅展开，不重复计入总耗时）</summary><p>总耗时已含：{r.input.route.includedTimes.join("、") || "范围待补"}</p>{r.input.route.details.length ? <ul>{r.input.route.details.map((s, i) => <li key={i}>{s.label} · {s.seconds === null ? "分项耗时未知" : `${s.seconds / 60} 分钟`}</li>)}</ul> : <p>未提供分项，不能凭空拆分总耗时。</p>}</details>
          <CheckDetails title="从建议出发时刻正向复核" check={r.suggestedCheck} />
          <CheckDetails title="从真实当前时间正向检查" check={current} />
          <p className="mt-3 text-sm">候选时刻复核 {r.attempts.length} / 3 轮（含首次；固定耗时直接计算）。</p>
          <ol className="text-sm">{r.attempts.map((a, i) => <li key={i}>第 {i + 1} 轮：{formatRedlineTime(a.candidateAt)} · {statusText[a.check.status]}</li>)}</ol>
          {ticket.mode === "train" ? <a className="mt-2 inline-flex min-h-11 items-center text-sm text-sage underline" href="https://www.12306.cn/" target="_blank" rel="noreferrer">前往 12306 核对与处理</a> : <a className="mt-2 inline-flex min-h-11 items-center text-sm text-sage underline" href="https://www.umetrip.com/" target="_blank" rel="noreferrer">前往航旅纵横核对与处理</a>}
          <Preferences ticket={ticket} result={r} plan={plan} tripId={tripId} onSaved={onSaved} onDirty={(changed) => setDirtyIds((ids) => changed ? [...new Set([...ids, ticket.id])] : ids.filter((id) => id !== ticket.id))} />
          <p className="mt-4 break-all text-xs text-graphite">计算版本 {r.calculationVersion} · 复核于 {formatRedlineTime(r.calculatedAt)}</p>
        </details>
      </article>;
    })}</div>
  </section>;
}
