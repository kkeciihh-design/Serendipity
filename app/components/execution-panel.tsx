"use client";
import { businessFetch } from "@/lib/business-fetch";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clock3, LocateFixed, MapPin } from "lucide-react";
import { executionSummary, executionTiming, orderedExecutionEvents, type ExecutionChange, type ExecutionView } from "@/lib/execution";
import { formatRedlineTime, liveRedlineCheck, redlineUrgency, type RedlineResult } from "@/lib/redlines";
import type { PlanVersionClient } from "./plan-overview";
import { TripBottomNav } from "./trip-bottom-nav";
import { useForegroundRefresh, useTravelClock } from "./use-travel-clock";
import { routeModeLabels } from "./route-summary";
type Data = { execution: ExecutionView; plan: PlanVersionClient; serverNow: string };
const button = "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-sage px-4 py-3 text-sm font-semibold text-sage disabled:opacity-50";
const primary = `${button} bg-sage text-white`;
const duration = (seconds: number) => seconds >= 86400 ? `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时` : seconds >= 3600 ? `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;

export function ExecutionPanel({ tripId }: { tripId: string }) {
  const [data, setData] = useState<Data | null>(null), [redlines, setRedlines] = useState<RedlineResult[] | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [geoMessage, setGeoMessage] = useState("");
  const [busy, setBusy] = useState(false), [needsRead, setNeedsRead] = useState(true), [manual, setManual] = useState("");
  const busyRef = useRef(false), serial = useRef(0);
  const { now, reliable, message: clockMessage, calibrate, invalidate } = useTravelClock();
  const readRedlines = useCallback(async (plan: PlanVersionClient, sequence: number) => {
    try {
      const response = await businessFetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/redlines`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const payload = await response.json();
      if (sequence !== serial.current) return;
      if (!response.ok || !payload.isCurrent) throw new Error();
      setRedlines(payload.redlines);
    } catch { if (sequence === serial.current) setRedlines(null); }
  }, [tripId]);
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const sequence = ++serial.current, sent = Date.now();
    try {
      const response = await businessFetch(`/api/trips/${tripId}/execution`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const payload = await response.json();
      if (sequence !== serial.current) return;
      if (!response.ok) throw new Error(payload.error || "进度读取失败。");
      calibrate(payload.serverNow, sent); setData(payload); setError(""); setNeedsRead(false); setRedlines(null);
      await readRedlines(payload.plan, sequence);
    } catch (e) {
      if (sequence !== serial.current) return;
      invalidate(true); setNeedsRead(true); setRedlines(null); setError(e instanceof TypeError ? "无法连接服务器，保留上次读到的进度。联网后请重新读取。" : e instanceof Error ? e.message : "读取失败，请重试。");
    }
  }, [tripId, calibrate, invalidate, readRedlines]);
  useForegroundRefresh(refresh, invalidate);
  useEffect(() => () => { serial.current++; }, []);
  async function save(change: ExecutionChange, locationRequest = false) {
    if (!data || busyRef.current || needsRead) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    const sequence = ++serial.current, sent = Date.now();
    try {
      const response = await businessFetch(`/api/trips/${tripId}/execution`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ expectedPlanVersion: data.plan.versionNumber, expectedRevision: data.execution.revision, change }) });
      const payload = await response.json();
      if (sequence !== serial.current) return;
      if (!response.ok) throw new Error(payload.error || "保存失败，请重新读取核对。");
      setData(payload); calibrate(payload.serverNow, sent); setNeedsRead(false); setMessage("已保存，刷新后可继续。");
      if (locationRequest) setGeoMessage("本次定位已保存，未自动推进步骤。");
      void readRedlines(payload.plan, sequence);
    } catch (e) {
      if (sequence !== serial.current) return;
      invalidate(true); setNeedsRead(true); setError(`${e instanceof TypeError ? "无法连接服务器。" : e instanceof Error ? e.message : "连接失败。"} 请重新读取确认是否已保存，再重试。`);
    } finally { busyRef.current = false; setBusy(false); }
  }
  async function locate() {
    if (!window.isSecureContext || !navigator.geolocation) { setGeoMessage("当前环境不支持安全定位，请使用手动位置与进度。"); return; }
    setGeoMessage("正在获取本次位置…");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 }));
      await save({ action: "locate", latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }, true);
    } catch { setGeoMessage("定位未获授权或暂不可用。手动选择步骤、标记到达和完成均可继续使用。"); }
  }
  const state = data?.execution, plan = data?.plan;
  const summary = state && plan ? executionSummary(plan.events, state, now ?? Date.parse(data!.serverNow)) : null;
  const current = summary?.current, currentItem = state?.items.find((i) => i.eventId === current?.id);
  const timing = current && now !== null ? executionTiming(current, now) : null;
  const done = new Set(state?.items.filter((i) => i.completedAt).map((i) => i.eventId) ?? []);
  const nextRedline = redlines?.filter((r) => !done.has(r.input.eventId)).sort((a, b) => (Date.parse(a.suggestedAt ?? a.input.departureAt ?? "") || Infinity) - (Date.parse(b.suggestedAt ?? b.input.departureAt ?? "") || Infinity))[0];
  const urgency = nextRedline && now !== null ? redlineUrgency(nextRedline.suggestedAt, now) : null;
  const check = nextRedline && now !== null ? liveRedlineCheck(nextRedline, now, reliable) : null;
  const location = state?.location;
  const next = summary?.next;
  const route = plan?.routeLegs?.find((r) => r.fromEventId === current?.id && r.toEventId === next?.id);
  return <>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4">
      <div><p className="flex items-center gap-2 text-sm text-graphite"><Clock3 className="size-4" />当前时间</p><p data-testid="execution-clock" className="mt-1 text-xl font-semibold tabular-nums">{now === null ? "校时中…" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now)}</p></div>
      <button className={button} disabled={busy} onClick={() => void refresh()}>重新读取</button>
      <p className="w-full text-xs leading-5 text-graphite">{clockMessage}</p>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-clay-soft p-4 text-sm text-clay">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-sage">{message}</p>}
    {!data && !error && <p className="mt-6">正在读取旅行进度…</p>}
    {state && plan && summary && <>
      <div className="mt-5 flex items-center justify-between gap-2 text-sm"><strong>{summary.status === "ended" ? "旅行已结束 · 全部完成" : summary.status === "active" ? "旅行进行中" : "尚未开始旅行"}</strong><span>已完成 {summary.completedCount} / {plan.events.length}</span></div>
      <progress aria-label="旅行完成进度" className="mt-2 h-2 w-full accent-sage" value={summary.completedCount} max={plan.events.length || 1} />
      {state.startedAt && summary.earlierIncompleteCount > 0 && <p className="mt-2 text-xs leading-5 text-graphite">还有 {summary.earlierIncompleteCount} 个更早步骤未记录完成，可在下方手动选择补记。</p>}
      {summary.scheduleEnded && summary.status !== "ended" && <p className="mt-3 text-sm text-clay">计划日期已结束，尚有步骤未记录完成；时间流逝不会替你完成活动。</p>}
      {!plan.requirementUpToDate && <p className="mt-3 text-sm text-clay">需求已变化，当前仍按已保存的计划记录进度；请核对剩余安排。</p>}
      {summary.status === "ended" ? <section className="mt-4 rounded-2xl bg-sage p-6 text-white"><Check className="size-7" /><h2 className="mt-3 text-2xl font-semibold">这一程，已走完</h2><p className="mt-2 text-sm">完成于 {formatRedlineTime(state.endedAt)}。到达、完成与位置记录已保留，可随时退出查看。</p></section> : current && <section aria-label="当前步骤" className="mt-4 rounded-2xl bg-sage p-5 text-white sm:p-7">
        <p className="text-xs font-semibold tracking-widest">{state.startedAt ? "现在这一步 · 手动进度" : "从这里开始 · 时间表建议"}</p>
        <h2 className="mt-3 break-words text-2xl font-semibold">{current.title}</h2>
        <p className="mt-2 flex items-start gap-2 text-sm"><MapPin className="mt-0.5 size-4 shrink-0" />{current.locationName}</p>
        <p className="mt-3 text-sm">计划：{current.date} {current.startTime} → {current.endDate && current.endDate !== current.date ? `${current.endDate} ` : ""}{current.endTime}</p>
        <p data-testid="execution-timing" className="mt-2 text-lg font-semibold">{currentItem?.completedAt ? "已手动完成" : currentItem?.arrivedAt ? "已手动标记到达" : timing?.phase === "future" ? `尚未到计划时刻 · 还有 ${duration(timing.seconds)}` : timing?.phase === "ongoing" ? `计划正在进行 · 距结束 ${duration(timing.seconds)}` : timing ? `计划时段已过 · 超过 ${duration(timing.seconds)}` : "时刻待确认"}</p>
        {currentItem?.arrivedAt && <p className="mt-1 text-sm">到达记录：{formatRedlineTime(currentItem.arrivedAt)}</p>}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">{!state.startedAt ? <button className={`${button} border-white bg-white text-sage sm:col-span-2`} disabled={busy || needsRead} onClick={() => void save({ action: "start", eventId: current.id })}>开始旅行</button> : <>
          <button className={`${button} border-white text-white`} disabled={busy || needsRead || Boolean(currentItem?.arrivedAt || currentItem?.completedAt)} onClick={() => void save({ action: "arrive", eventId: current.id })}>我已到达</button>
          <button className={`${button} border-white bg-white text-sage`} disabled={busy || needsRead || Boolean(currentItem?.completedAt)} onClick={() => void save({ action: "complete", eventId: current.id })}><Check className="size-4" />完成这一步</button>
        </>}</div>
      </section>}
      {state.startedAt && !state.endedAt && <label className="mt-4 block text-sm font-semibold">手动选择当前步骤<select aria-label="手动选择当前步骤" className="mt-2 min-h-12 w-full min-w-0 rounded-lg border border-sand bg-white p-3 font-normal" value={current?.id ?? ""} disabled={busy || needsRead} onChange={(e) => void save({ action: "select", eventId: e.target.value })}>{orderedExecutionEvents(plan.events).map((e) => <option key={e.id} value={e.id}>{done.has(e.id) ? "✓ " : ""}第{e.dayNumber}天 {e.startTime} {e.title}</option>)}</select></label>}
      {next && summary.status !== "ended" && <section aria-label="下一步" className="mt-5 rounded-xl border border-sand bg-white p-5"><p className="flex items-center gap-2 text-sm text-sage"><ArrowRight className="size-4" />接下来</p><h2 className="mt-2 break-words text-lg font-semibold">{next.title}</h2><p className="mt-1 text-sm text-graphite">{next.date} {next.startTime} · {next.locationName}</p>
        <p className="mt-3 text-sm leading-6">{route ? `${routeModeLabels[route.mode]} · ${route.durationSeconds === null ? "耗时待确认" : `参考约 ${Math.ceil(route.durationSeconds / 60)} 分钟`} · ${route.status === "verified" ? "按原查询时刻的路线参考" : "估算 / 待确认"}` : "这两步之间暂无可用的交通指引，请打开地图核对路线。"}</p>
        {route && <p className="mt-1 text-xs text-graphite">路线依据 {route.date} {route.departureTime} 从前一步出发；不代表已按本次定位重查。</p>}
        <Link className={`${button} mt-3`} href={`/trips/${tripId}?view=map#plan-views`}>查看地图与交通</Link></section>}
      <section aria-label="下一条红线" className={`mt-5 rounded-xl border p-5 ${urgency?.color === "red" || check?.status === "infeasible" ? "border-red-300 bg-red-50" : "border-clay/30 bg-white"}`}>
        <h2 className="font-semibold">下一条红线</h2>
        {!redlines ? <p className="mt-2 text-sm">红线待重新读取，当前不能判断时间是否充裕。</p> : !nextRedline ? <p className="mt-2 text-sm">暂无未完成交通的有效票据红线；这不表示所有安排都已核实。</p> : <>
          <p className="mt-2 text-sm">{nextRedline.input.direction === "departure" ? "去程" : "返程"} · {nextRedline.precision === "verified" ? "按适用时刻复核" : "估算 / 待确认"}</p>
          <p className="mt-2 text-lg font-semibold">建议最晚 {formatRedlineTime(nextRedline.suggestedAt)}</p>
          <p className="mt-2 font-semibold">{urgency?.remainingSeconds === null ? "倒计时待补资料" : (urgency?.remainingSeconds ?? 0) <= 0 ? "已到或已过建议行动时间" : `距建议行动还有 ${duration(urgency!.remainingSeconds!)}`}</p>
          <p className="mt-2 text-sm">{check?.status === "infeasible" ? "按当前截止已无法衔接，请核对票据并调整剩余安排。" : check?.status === "insufficient_margin" ? "余量不足，请尽快核对并行动。" : check?.status === "feasible" ? "按所列起点与估算耗时仍有余量，不能保证实际赶上。" : "当前路线与时间可行性待确认。"}</p>
          <p className="mt-2 text-xs leading-5 text-graphite">计算假设从「{nextRedline.input.origin}」出发到「{nextRedline.input.destination}」，未用当前位置自动替换起点；建议不是官方截止。</p>
        </>}
        <Link className={`${button} mt-3`} href={`/trips/${tripId}#time-redlines`}>查看红线依据</Link>
      </section>
      <Link className={`${primary} mt-4 w-full`} href={`/trips/${tripId}?view=replan#plan-views`}>迟到了或计划有变 · AI 重新规划</Link>
      <section aria-label="当前位置来源" className="mt-5 rounded-xl border border-sand bg-white p-5">
        <h2 className="font-semibold">当前位置 / 最近位置记录</h2>
        <p className="mt-2 break-words text-sm leading-6">{location?.source === "manual" ? `手动记录：${location.label}` : location?.source === "geolocation" ? `浏览器本次定位（WGS84）：${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}，精度约 ${Math.round(location.accuracy)} 米` : summary.estimatedLocation ? `预计位置：${summary.estimatedLocation}（按时间表推测，未经定位确认）` : "位置未知：可手动填写，也可选择获取本次定位。"}</p>
        {location && <p className="mt-2 text-xs text-graphite">记录于 {formatRedlineTime(location.recordedAt)}，不是持续实时位置。{now !== null && now - Date.parse(location.recordedAt) > 300_000 ? "此记录已超过 5 分钟，请核对。" : ""}</p>}
        <label className="mt-3 block text-sm">手动位置<input value={manual} onChange={(e) => setManual(e.target.value)} maxLength={120} placeholder="例如：长沙南站东进站口" className="mt-1 min-h-12 w-full rounded-lg border border-sand p-3" /></label>
        <div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={busy || needsRead || !manual.trim()} onClick={() => void save({ action: "manual_location", label: manual.trim() })}>保存手动位置</button><button className={button} disabled={busy || needsRead} onClick={() => void locate()}><LocateFixed className="size-4" />获取本次定位</button>{location && <button className={button} disabled={busy || needsRead} onClick={() => void save({ action: "clear_location" })}>清除位置记录</button>}</div>
        {geoMessage && <p role="status" className="mt-3 text-sm leading-6 text-graphite">{geoMessage}</p>}
        <p className="mt-3 text-xs leading-5 text-graphite">定位可选，仅保存最近一次位置，不持续收集轨迹。选择步骤不等于到达；定位也不会自动完成步骤。</p>
      </section>
      {state.items.length > 0 && <details className="mt-5 rounded-xl border border-sand bg-white p-4"><summary className="min-h-11 cursor-pointer py-2 font-semibold">查看到达与完成记录</summary><ul className="space-y-3 text-sm">{state.items.map((i) => <li key={i.eventId}><strong>{i.title}</strong><p>到达：{i.arrivedAt ? formatRedlineTime(i.arrivedAt) : "未记录"} · 完成：{i.completedAt ? formatRedlineTime(i.completedAt) : "未完成"}</p></li>)}</ul></details>}
      <p className="mt-5 text-xs leading-6 text-graphite">计划 V{plan.versionNumber} · 进度修订 {state.revision}。退出执行模式不删除记录。页面关闭后不会继续定位或准点提醒；断网不能提交进度，也不提供离线重开。</p>
      <p className="mt-1 text-xs leading-6 text-graphite">当前为本机运行；手机布局可用，但此本机地址无法在外出时从另一台手机访问。</p>
    </>}
    <TripBottomNav tripId={tripId} />
  </>;
}
