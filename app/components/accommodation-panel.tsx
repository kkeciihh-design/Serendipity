"use client";
import { businessFetch } from "@/lib/business-fetch";

import { useEffect, useRef, useState } from "react";
import { BedDouble, MapPin } from "lucide-react";
import { formatMoneyRange } from "@/lib/budget";
import { nightsBetween, type StayInput, type StayPreview, type StayRecommendations } from "@/lib/accommodations";
import type { SignedPlaceCandidate } from "@/lib/places";
import type { MapMarker } from "@/lib/map-link";
import type { PlanVersionClient } from "./plan-overview";
import { MapCanvas } from "./map-canvas";

const field = "mt-1 min-h-11 w-full rounded-md border border-sand bg-white px-3 text-charcoal";
function parseMoneyInput(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim()) || Number(value) > 20_000_000) throw new Error("金额须为非负数，最多两位小数。");
  const [yuan, cents = ""] = value.trim().split(".");
  return Number(yuan) * 100 + Number(cents.padEnd(2, "0"));
}
const button = "min-h-11 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage disabled:opacity-50";
export function AccommodationPanel({ tripId, plan, onSaved }: { tripId: string; plan: PlanVersionClient; onSaved: (plan: PlanVersionClient) => void }) {
  const stays = plan.events.filter((e) => e.type === "accommodation");
  const [eventId, setEventId] = useState(stays[0]?.id ?? "");
  if (!stays.length) return <p className="rounded-md bg-white p-6">此计划没有住宿安排。</p>;
  return <section className="space-y-5" aria-label="住宿区域推荐"><div className="flex flex-wrap items-end justify-between gap-4"><div><h3 className="flex items-center gap-2 text-xl font-semibold"><BedDouble className="size-6 text-sage" />这趟旅行，住在哪里</h3><p className="mt-2 text-sm text-graphite">比较位置取舍，再确定酒店和入住资料。</p></div><label className="text-sm">查看哪晚的住宿<select className={field} value={eventId} onChange={(e) => setEventId(e.target.value)}>{stays.map((s) => <option key={s.id} value={s.id}>{s.date} · {s.locationName}</option>)}</select></label></div><StayEditor key={`${plan.id}:${eventId}`} {...{ tripId, plan, eventId, onSaved }} /></section>;
}
function StayEditor({ tripId, plan, eventId, onSaved }: { tripId: string; plan: PlanVersionClient; eventId: string; onSaved: (plan: PlanVersionClient) => void }) {
  const [data, setData] = useState<StayRecommendations | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null), [retry, setRetry] = useState(0), [showMap, setShowMap] = useState(false);
  const [areaId, setAreaId] = useState(""), [kind, setKind] = useState<"area" | "hotel">("area");
  const [checkIn, setCheckIn] = useState(""), [checkOut, setCheckOut] = useState(""), [rooms, setRooms] = useState("1");
  const [min, setMin] = useState(""), [max, setMax] = useState(""), [morning, setMorning] = useState("07:00");
  const [checkInFrom, setCheckInFrom] = useState(""), [checkOutBy, setCheckOutBy] = useState("");
  const [storage, setStorage] = useState<StayInput["luggageStorage"]>("unknown"), [note, setNote] = useState("");
  const [mode, setMode] = useState<StayInput["routeMode"]>("public_transit"), [ack, setAck] = useState(false);
  const [keywords, setKeywords] = useState(""), [candidates, setCandidates] = useState<SignedPlaceCandidate[]>([]), [hotelToken, setHotelToken] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState(""), [preview, setPreview] = useState<StayPreview | null>(null);
  const control = useRef<AbortController | null>(null), previewRef = useRef<HTMLDivElement | null>(null);
  const endpoint = `/api/trips/${tripId}/plans/${plan.versionNumber}`;
  useEffect(() => {
    const controller = new AbortController(); control.current = controller;
    businessFetch(`${endpoint}/accommodations?eventId=${encodeURIComponent(eventId)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) }).then(async (r) => {
      const payload = await r.json(); if (!r.ok) throw new Error(payload.error); if (controller.signal.aborted) return;
      const d: StayRecommendations = payload.recommendations; setData(d); setAreaId(d.existing?.areaId ?? d.areas[0].id); setKind(d.existing?.kind ?? "area");
      setCheckIn(d.checkIn); setCheckOut(d.checkOut); setRooms(String(d.roomCount));
      setMin(d.price.minCents === null ? "" : String(d.price.minCents / 100)); setMax(d.price.maxCents === null ? "" : String(d.price.maxCents / 100));
      setMorning(d.existing?.morningDepartureTime ?? "07:00"); setCheckInFrom(d.existing?.checkInFrom ?? ""); setCheckOutBy(d.existing?.checkOutBy ?? ""); setStorage(d.existing?.luggageStorage ?? "unknown"); setNote(d.existing?.conditionNote ?? ""); setError("");
    }).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "住宿加载失败，请重试。"); });
    return () => { controller.abort(); control.current?.abort(); };
  }, [endpoint, eventId, retry]);
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [preview]);
  async function request(body: unknown, path: string, task: string) {
    control.current?.abort(); const controller = new AbortController(); control.current = controller; setBusy(task); setError("");
    try {
      const r = await businessFetch(`${endpoint}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(task === "预览" ? 100_000 : 30_000)]) });
      const p = await r.json(); if (!r.ok) throw new Error(p.error ?? "请求失败，请重试。");
      if (!controller.signal.aborted) return p;
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error && !/Timeout|abort/i.test(e.message) ? e.message : task === "保存" ? "保存未及时返回，请刷新核对当前版本。" : "请求超时，请重试。"); }
    finally { if (!controller.signal.aborted) setBusy(null); }
  }
  async function search() {
    setCandidates([]); setHotelToken(null); setSearchMessage("");
    const p = await request({ eventId, city: plan.requestSnapshot.destination, keywords }, "places", "搜索");
    if (p) { setCandidates(p.candidates); setSearchMessage(p.candidates.length ? "请核对具体酒店、城市与完整地址。地图地点不代表酒店有房。" : "没有找到具体酒店资料，请换完整名称搜索；仍可先保存区域偏好。"); }
  }
  async function makePreview() {
    try {
      const stay: StayInput = { areaId, kind, hotelToken, routeMode: mode, checkIn, checkOut, roomCount: Number(rooms), minCents: parseMoneyInput(min), maxCents: parseMoneyInput(max), morningDepartureTime: morning,
        checkInFrom: checkInFrom || null, checkOutBy: checkOutBy || null, luggageStorage: storage, conditionNote: note, acknowledged: true };
      const p = await request({ action: "preview", eventId, stay }, "accommodations", "预览"); if (p) setPreview(p.preview);
    } catch (e) { setError(e instanceof Error ? e.message : "请核对入住资料。"); }
  }
  async function save() { if (!preview) return; const p = await request({ action: "apply", eventId, previewToken: preview.previewToken }, "accommodations", "保存"); if (p) onSaved(p.plan); }
  if (!data) return <div className="rounded-md bg-white p-6">{error ? <><p role="alert">{error}</p><button className={button} onClick={() => setRetry((n) => n + 1)}>重试住宿资料</button></> : <p role="status">正在比较住宿区域…</p>}</div>;
  const disabled = !!busy || !!preview || data.protection.length > 0;
  const markers: MapMarker[] = data.areas.flatMap((a, i) => a.reference ? [{ ...a.reference, placeId: `area-${a.id}`, precision: "area_reference" as const, name: `${a.name}（区域参考点）`.slice(0, 160), events: [{ id: a.id, visitNumber: i + 1, title: a.name.slice(0, 120), timeRange: "区域参考 · 未确定酒店" }] }] : []);
  const totalNights = nightsBetween(checkIn, checkOut);
  return <div className="space-y-5">
    <div className="rounded-md border border-sand bg-white p-4 text-sm leading-6"><p className="font-semibold text-sage">{data.existing ? `${data.existing.kind === "hotel" ? "已确认具体酒店地点" : "已选择区域偏好"} · ${data.eventName}` : "尚未确定住宿"}</p><p>{data.conclusion}</p><p>房态：未知 · 预订：本应用未办理 · 价格：单独记录预算估算</p>{data.protection.map((p) => <p key={p} className="text-clay">{p}</p>)}</div>
    <fieldset disabled={disabled} className="grid gap-4 lg:grid-cols-3"><legend className="mb-3 font-semibold">比较 {data.areas.length} 个住宿区域</legend>{data.areas.map((a, i) => <label key={a.id} className={`cursor-pointer rounded-md border p-4 ${areaId === a.id ? "border-sage bg-sage-soft" : "border-sand bg-white"}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-sage">{i === 0 ? "优先比较" : "备选方向"} · {a.focus}</span><input type="radio" name="area" value={a.id} checked={areaId === a.id} onChange={() => { setAreaId(a.id); setAck(false); }} aria-label={`选择${a.name}`} /></div><h4 className="mt-3 text-lg font-semibold">{a.name}</h4><p className="mt-2 text-sm leading-6 text-graphite">{a.reasons[0]}</p><dl className="mt-3 space-y-2 text-sm">{a.distances.map((d) => <div key={d.label}><dt className="text-graphite">{d.label} · {d.name}</dt><dd>{d.meters === null ? "距离待定位" : `直线约 ${(d.meters / 1000).toFixed(1)} km`}</dd></div>)}</dl><p className="mt-4 text-sm font-semibold">预算参考 {formatMoneyRange(a.price.minCents, a.price.maxCents)} / 房 / 晚</p><p className="mt-1 text-xs leading-5 text-graphite">{a.price.source}</p>{a.conflicts.map((c) => <p key={c} className="mt-2 text-sm text-clay">{c}</p>)}</label>)}</fieldset>
    <details className="rounded-md border border-sand bg-white p-4 text-sm leading-6"><summary className="cursor-pointer font-semibold">推荐依据与资料限制</summary>{data.areas[0].reasons.slice(1).map((r) => <p key={r}>{r}</p>)}{data.areas.find((a) => a.id === areaId)?.warnings.map((w) => <p key={w}>{w}</p>)}</details>
    <button className={button} onClick={() => setShowMap(!showMap)}><MapPin className="mr-2 inline size-4" />{showMap ? "收起区域参考地图" : "查看区域参考地图"}</button>
    {showMap && (markers.length ? <div className="space-y-2"><p className="text-sm text-graphite">圆形参考标记仅说明区域方位；不是酒店位置或区域边界。</p><MapCanvas markers={markers} focusEventId={areaId} onEventSelect={disabled ? undefined : (id) => { setAreaId(id); setAck(false); }} /></div> : <p className="rounded-md bg-shell p-4 text-sm">相关地点尚未定位，暂不画区域中点；请先在地图确认活动与返程站。</p>)}
    <fieldset disabled={disabled} onChange={() => setAck(false)} className="space-y-4 rounded-md border border-sand bg-white p-4 disabled:opacity-70"><legend className="px-1 font-semibold">入住与预算</legend><div className="flex flex-wrap gap-4"><label><input type="radio" name="stay-kind" checked={kind === "area"} onChange={() => setKind("area")} /> 先保存区域偏好</label><label><input type="radio" name="stay-kind" checked={kind === "hotel"} onChange={() => setKind("hotel")} /> 确认具体酒店</label></div>
      {kind === "hotel" && <div className="space-y-3 rounded-md bg-shell p-4"><label className="block text-sm">酒店完整名称<input className={field} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="输入具体门店名称" /></label><button type="button" disabled={!keywords.trim()} className={button} onClick={search}>搜索酒店地点</button>{data.existing?.kind === "hotel" && !hotelToken && <p className="text-sm">保留当前酒店：{data.eventName}；搜索并选择后才更换。</p>}<p role="status" className="text-sm">{searchMessage}</p>{candidates.map((c) => <label key={c.selectionToken} className="block rounded-md border border-sand bg-white p-3 text-sm"><input type="radio" name="hotel" checked={hotelToken === c.selectionToken} onChange={() => setHotelToken(c.selectionToken)} /> {c.name} · {c.city}<span className="mt-1 block text-graphite">{c.address} · {c.category}</span><span className="block text-xs text-graphite">{c.provider === "osm" ? "OpenStreetMap / Nominatim" : "高德地图"} · 获取于 {c.retrievedAt.slice(0, 10)} · 价格和房态未知</span></label>)}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><label className="min-w-0 text-sm">入住日期<input type="date" className={field} value={checkIn} min={plan.requestSnapshot.startDate ?? undefined} max={plan.requestSnapshot.endDate ?? undefined} onChange={(e) => setCheckIn(e.target.value)} /></label><label className="min-w-0 text-sm">离店日期<input type="date" className={field} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></label><label className="min-w-0 text-sm">房间数<input type="number" min="1" max="100" className={field} value={rooms} onChange={(e) => setRooms(e.target.value)} /></label></div>
      <p className="text-sm text-sage">本次 {Number.isFinite(totalNights) ? totalNights : "待填"} 晚 · {rooms || "待填"} 房，按实际入住晚数计费。</p>
      <div className="grid grid-cols-2 gap-3"><label className="min-w-0 text-sm">每房每晚下限（元）<input className={field} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="未知" /></label><label className="min-w-0 text-sm">每房每晚上限（元，可空）<input className={field} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="与下限相同" /></label></div>
      <p className="text-xs leading-5 text-graphite">以上是手填预算，留空表示未知，0表示明确免费；确认地点不会将价格升级为酒店报价。</p>
      <details className="rounded-md bg-shell p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">入住时段、行李寄存与接驳（可选）</summary><div className="mt-3 space-y-4">
      <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm">酒店可入住时间<input type="time" className={field} value={checkInFrom} onChange={(e) => setCheckInFrom(e.target.value)} /></label><label className="text-sm">酒店退房截止<input type="time" className={field} value={checkOutBy} onChange={(e) => setCheckOutBy(e.target.value)} /></label><label className="text-sm">每天早晨离店时刻<input type="time" className={field} value={morning} onChange={(e) => setMorning(e.target.value)} /></label></div>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">行李寄存<select className={field} value={storage} onChange={(e) => setStorage(e.target.value as StayInput["luggageStorage"])}><option value="unknown">尚未确认</option><option value="available">已向酒店确认可寄存</option><option value="unavailable">酒店不可寄存</option></select></label><label className="text-sm">酒店接驳方式<select className={field} value={mode} onChange={(e) => setMode(e.target.value as StayInput["routeMode"])}><option value="public_transit">公共交通（资料不足时待确认）</option><option value="walking">步行</option><option value="driving">乘车路线参考（车费另确认）</option></select></label></div>
      <label className="block text-sm">入住与寄存条件来源说明<textarea className={`${field} py-2`} maxLength={240} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：酒店前台告知的日期、房型容量、寄存时段与费用；尚未核对可留空" /></label>
      </div></details>
    </fieldset>
    {!preview && <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1 size-4" type="checkbox" disabled={disabled} checked={ack} onChange={(e) => setAck(e.target.checked)} />我已核对地点、日期和房数，理解这只记录住宿选择，不代表已预订或有房。</label>}
    {error && <p role="alert" className="rounded-md bg-clay-soft p-4 text-sm text-clay">{error}</p>}
    {preview && <div ref={previewRef} aria-label="住宿调整预览" className="space-y-3 rounded-md border-2 border-sage bg-white p-5"><h4 className="text-lg font-semibold">住宿调整预览</h4>{preview.changes.map((c) => <p className="text-sm leading-6" key={c}>{c}</p>)}<div className="rounded-md bg-shell p-3 text-sm leading-6"><p>原全程预算：{formatMoneyRange(preview.beforeBudget.totalMinCents, preview.beforeBudget.totalMaxCents)}，另有{preview.beforeBudget.unknownItemCount}项未知</p><p>调整后预算：{formatMoneyRange(preview.afterBudget.totalMinCents, preview.afterBudget.totalMaxCents)}，另有{preview.afterBudget.unknownItemCount}项未知</p></div>{preview.routes.map((r, i) => <p key={i} className="text-sm leading-6">{r.date} · {r.label}：{r.durationSeconds === null ? "耗时待确认" : `预计${Math.ceil(r.durationSeconds / 60)}分钟`}</p>)}{preview.conflicts.map((c) => <p role="alert" key={c} className="text-sm text-clay">{c}</p>)}<details><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">仍需确认（{preview.warnings.length}）</summary>{preview.warnings.map((w) => <p key={w} className="text-sm leading-6 text-graphite">{w}</p>)}</details></div>}
    <div className="flex flex-wrap gap-3">{preview ? <><button className={`${button} bg-sage text-white`} disabled={!!busy || !preview.canApply} onClick={save}>{busy === "保存" ? "保存中…" : "应用住宿选择"}</button><button className={button} disabled={busy === "保存"} onClick={() => { setPreview(null); setAck(false); }}>返回修改</button></> : <button className={`${button} bg-sage text-white`} disabled={disabled || !ack} onClick={makePreview}>{busy === "预览" ? "正在重算交通和预算…" : "预览住宿选择"}</button>}{busy && busy !== "保存" && <button className={button} onClick={() => { control.current?.abort(); setBusy(null); }}>取消本次查询</button>}</div>
  </div>;
}
