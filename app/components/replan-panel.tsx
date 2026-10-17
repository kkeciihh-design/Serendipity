"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, RotateCcw } from "lucide-react";
import { formatMoneyRange } from "@/lib/budget";
import { formatRedlineTime } from "@/lib/redlines";
import type { ReplanCandidateView } from "@/lib/replan-service";
import type { PlanRequestState, PlanVersionClient } from "./plan-overview";

export function ReplanPanel({ tripId, plan, requestState, onSaved }: { tripId: string; plan: PlanVersionClient; requestState: PlanRequestState; onSaved: (plan: PlanVersionClient) => void }) {
  const [reason, setReason] = useState("");
  const [candidate, setCandidate] = useState<ReplanCandidateView | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [needsRequest, setNeedsRequest] = useState(false);
  const controller = useRef<AbortController | null>(null), lock = useRef(false), sequence = useRef(0);
  const endpoint = `/api/trips/${tripId}/replan`;
  const read = useCallback(async () => {
    const run = ++sequence.current;
    try {
      const response = await businessFetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (run !== sequence.current) return;
      setCandidate(body.candidate); setCanUndo(body.canUndo);
    } catch (error) { if (run === sequence.current) setMessage(error instanceof Error ? error.message : "读取失败，请重试。"); }
  }, [endpoint]);
  useEffect(() => { void read(); return () => { sequence.current++; controller.current?.abort(); }; }, [read, plan.id]);
  async function submit(action: "preview" | "apply" | "cancel" | "undo") {
    if (lock.current) return;
    lock.current = true; setBusy(action); setMessage(""); setNeedsRequest(false);
    const requestController = new AbortController(); controller.current = requestController;
    const run = ++sequence.current;
    const timer = window.setTimeout(() => requestController.abort(), 110_000);
    try {
      const payload = action === "preview" ? { action, reason, expectedPlanVersion: plan.versionNumber, expectedRequestRevision: requestState.requestRevision }
        : action === "undo" ? { action, expectedPlanVersion: plan.versionNumber, expectedRequestRevision: requestState.requestRevision }
        : { action, candidateId: candidate?.id, expectedCandidateRevision: candidate?.revision };
      const response = await businessFetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: requestController.signal });
      const body = await response.json();
      if (run !== sequence.current) return;
      if (!response.ok) { setNeedsRequest(Boolean(body.requirementChange)); throw new Error(body.error); }
      if (body.outcome === "applied") { setCandidate(null); setCanUndo(true); setMessage(`已应用到版本 ${body.plan.versionNumber}，日程、地图、预算和清单已同步。`); onSaved(body.plan); }
      else if (body.cancelled) { setCandidate(null); setMessage("已取消候选，当前行程保持不变。"); }
      else { setCandidate(body.candidate); setMessage(body.outcome === "review_required" ? "复核发现方案或关联状态有变化。已更新下方预览，请再次核对后应用。" : "候选已生成，当前行程尚未改变。"); }
    } catch (error) {
      if (run === sequence.current) setMessage(requestController.signal.aborted ? "等待已取消或超时，请重新读取核对；未收到响应不代表一定未保存。" : error instanceof Error ? error.message : "保存失败，请重新读取核对。");
    } finally { window.clearTimeout(timer); if (run === sequence.current) { setBusy(null); lock.current = false; } }
  }
  const ready = requestState.confirmed && !requestState.hasUnsavedEdits;
  if (!plan.isCurrent) return <p className="p-5 text-sm text-graphite">历史版本只读，请返回当前计划后调整剩余行程。</p>;
  return <section className="rounded-2xl border border-sage/20 bg-white p-5 sm:p-7" aria-label="AI 重新规划">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-xl font-semibold text-ink"><Sparkles className="size-5 text-sage" />调整剩余旅行</h3><p className="mt-2 text-sm leading-6 text-graphite">说说发生了什么，先比较变化，再决定是否应用。已确定安排、有效票据和费用会受到保护。</p></div>
      <button type="button" disabled={!!busy} onClick={() => { void read(); }} className="min-h-11 px-3 text-sm text-sage">重新读取</button></div>
    {!ready && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">请先保存并确认旅行需求。<a href="#request-workspace" className="ml-2 underline">前往旅行需求</a></p>}
    <label htmlFor="replan-reason" className="mt-5 block text-sm font-semibold">这次想怎么调整？</label>
    <textarea id="replan-reason" maxLength={600} rows={3} value={reason} disabled={!!busy} onChange={(e) => setReason(e.target.value)} placeholder="例如：下雨了，把下午的户外游览改为室内；晚起一小时；不去某个景点" className="mt-2 w-full rounded-xl border border-sage/25 bg-paper p-3 text-sm leading-6" />
    <div className="mt-3 flex flex-wrap gap-2">{["下雨了，把户外活动换成室内", "晚起一小时，调整剩余安排"].map((text) => <button type="button" disabled={!!busy} onClick={() => setReason(text)} key={text} className="min-h-11 rounded-full bg-sage/10 px-3 text-sm text-sage">{text}</button>)}</div>
    <div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => { void submit("preview"); }} disabled={!!busy || !ready || reason.trim().length < 2} className="min-h-11 rounded-xl bg-sage px-5 py-3 font-semibold text-white disabled:opacity-50">{busy === "preview" ? "正在规划…" : "生成调整预览"}</button>
      {canUndo && <button type="button" disabled={!!busy || !ready} onClick={() => { void submit("undo"); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sage/30 px-4 text-sm text-sage"><RotateCcw className="size-4" />预览撤销上次调整</button>}
      {busy && busy !== "cancel" && <button type="button" onClick={() => controller.current?.abort()} className="min-h-11 px-3 text-sm text-graphite">停止等待</button>}</div>
    {message && <p role="status" className="mt-4 rounded-xl bg-paper p-3 text-sm leading-6">{message}{needsRequest && <a href="#request-workspace" className="ml-2 text-sage underline">修改并确认旅行需求</a>}</p>}
    {candidate && <div className="mt-6 border-t border-sage/20 pt-5" data-testid="replan-preview">
      <h4 className="text-lg font-semibold">{candidate.kind === "undo" ? "撤销预览" : "方案对比"}</h4>
      <p className="mt-2 text-sm text-graphite">基于计划 V{candidate.baseVersion} · 已确认需求 R{candidate.requestRevision} · {candidate.changes.length} 项变化</p>
      <div className="mt-4 space-y-3">{candidate.changes.map((change) => <article key={change.eventId} className="rounded-xl bg-paper p-4">
        <p className="font-semibold">{!change.after ? "取消" : !change.before ? "恢复" : change.before.title !== change.after.title ? "替换" : "调整"} · {change.before?.title ?? change.after?.title}</p>
        <div className="mt-2 grid gap-3 text-sm leading-6 sm:grid-cols-2"><div><span className="text-graphite">原安排</span><p>{change.before ? `${change.before.date} ${change.before.startTime}–${change.before.endTime} ${change.before.title}` : "无"}</p></div><div><span className="text-sage">新安排</span><p>{change.after ? `${change.after.date} ${change.after.startTime}–${change.after.endTime} ${change.after.title}` : "取消这项活动"}</p><p className="text-graphite">{change.after?.locationName} {change.after?.note}</p></div></div>
      </article>)}</div>
      <p className="mt-4 text-sm">预算：{formatMoneyRange(candidate.budget.before.totalMinCents, candidate.budget.before.totalMaxCents)} → {formatMoneyRange(candidate.budget.after.totalMinCents, candidate.budget.after.totalMaxCents)}。未知费用仍需确认，取消不代表退款。</p>
      <details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-semibold text-sage">路线、红线与清单影响</summary><p className="leading-6">{candidate.plan.routeLegs.length} 段路线 · {candidate.checklist.filter((i) => !i.deleted && !i.orphaned).length} 项准备事项</p>{candidate.redlines.map((r) => <p key={r.input.id} className="mt-2 leading-6">{r.input.direction === "return" ? "返程" : "出发"}：建议 {formatRedlineTime(r.suggestedAt)}；{r.precision === "verified" ? "按所列来源核验" : "估算 / 待确认"}。{r.reason}</p>)}<ul className="mt-2 list-disc space-y-2 pl-5">{candidate.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
      <p className="mt-4 text-xs leading-5 text-graphite">最近核验：{formatRedlineTime(candidate.verifiedAt)}（北京时间）。应用时会重新检查当前时钟；已经赶不上会拒绝，实质变化会重新展示预览。</p>
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={!!busy || !ready} onClick={() => { void submit("apply"); }} className="min-h-11 rounded-xl bg-sage px-5 py-3 font-semibold text-white disabled:opacity-50">{busy === "apply" ? "正在复核…" : "确认应用这份方案"}</button><button type="button" disabled={!!busy} onClick={() => { void submit("cancel"); }} className="min-h-11 rounded-xl border border-sage/30 px-4 text-sm">取消这份候选</button></div>
    </div>}
  </section>;
}
