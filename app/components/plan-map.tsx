"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import type { Place, SignedPlaceCandidate } from "@/lib/places";
import { buildPlanOverviewDays } from "@/lib/plan-overview";
import type { PlanVersionClient } from "./plan-overview";
import { MapCanvas } from "./map-canvas";

const inputStyle = "mt-1 min-h-12 w-full rounded-md border border-sand bg-cream px-3 py-2 text-base text-charcoal";
const actionStyle = "min-h-12 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage disabled:opacity-50";

export function PlanMap({ tripId, plan, onSaved, selectedDayNumber, onDayChange }: { tripId: string; plan: PlanVersionClient; onSaved: (plan: PlanVersionClient) => void; selectedDayNumber: number; onDayChange: (day: number) => void }) {
  const days = buildPlanOverviewDays(plan.events, plan.requestSnapshot);
  const day = days.some((item) => item.dayNumber === selectedDayNumber) ? selectedDayNumber : days[0]?.dayNumber ?? 1;
  const editor = useRef<HTMLElement>(null);
  const [cityFilter, setCityFilter] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [city, setCity] = useState(plan.requestSnapshot.destination ?? "");
  const [keywords, setKeywords] = useState("");
  const [candidates, setCandidates] = useState<SignedPlaceCandidate[]>([]);
  const [selectedToken, setSelectedToken] = useState("");
  const [precision, setPrecision] = useState<Place["precision"]>("poi");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const events = plan.events.filter((event) => event.dayNumber === day);
  const dayPlaces = (plan.places ?? []).filter((place) => events.some((event) => event.placeId === place.id));
  const cities = [...new Set(dayPlaces.map((place) => place.city))];
  const filter = cities.includes(cityFilter) ? cityFilter : "";
  const places = useMemo(() => (plan.places ?? []).filter((place) => plan.events.some((event) => event.dayNumber === day && event.placeId === place.id) && (!filter || place.city === filter)), [plan, day, filter]);
  const editing = events.find((event) => event.id === editingId);
  const selected = candidates.find((candidate) => candidate.selectionToken === selectedToken);
  const areaOnly = selected && /地名地址|行政地名|boundary:|place:(city|town|village|suburb|neighbourhood|quarter|county|state)/.test(selected.category);
  const resetSearch = () => { controller.current?.abort(); setCandidates([]); setSelectedToken(""); setFeedback(""); setBusy(false); };

  const search = async () => {
    if (!editing) return;
    const active = new AbortController(); controller.current?.abort(); controller.current = active;
    setBusy(true); setCandidates([]); setSelectedToken(""); setFeedback("正在搜索地点…");
    try {
      const response = await fetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/places`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: editing.id, city, keywords }), signal: active.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "地点搜索失败。");
      if (active.signal.aborted) return;
      setCandidates(data.candidates); setFeedback(data.candidates.length ? "请核对城市、名称与完整地址，再选择地点。" : "没有找到地点。可换用更具体的名称或公共地标；此安排仍保留待确认位置。");
    } catch (error) { if (!active.signal.aborted) setFeedback(error instanceof Error ? error.message : "地点搜索失败，原行程已保留。"); }
    finally { if (!active.signal.aborted) setBusy(false); }
  };
  const save = async (remove = false) => {
    if (!editing) return;
    const active = new AbortController(); controller.current = active; setBusy(true); setSaving(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/places`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: editing.id, selectionToken: remove ? null : selectedToken, precision: areaOnly ? "area_reference" : precision }), signal: active.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存地点失败。");
      if (!active.signal.aborted) onSaved(data.plan);
    } catch (error) { if (!active.signal.aborted) setFeedback(error instanceof Error ? error.message : "保存失败，原计划已保留。"); }
    finally { if (!active.signal.aborted) { setBusy(false); setSaving(false); } }
  };
  return <section className="mt-4" aria-label="地图定位">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-lg font-semibold text-charcoal"><MapPin className="size-5 text-sage" />行程地点</h3>
        <p className="mt-1 text-sm leading-6 text-graphite">选择准确地点后才会标点。地点确认不代表门票、营业时间或住宿已核验。</p></div>
      <Link href="/settings#map-settings" className="min-h-11 py-2 text-sm text-sage underline">地图设置</Link>
    </div>
    <div className="my-3 flex flex-wrap gap-3">
      <label className="text-sm text-graphite">地图日期<select aria-label="地图日期" value={day} onChange={(event) => { resetSearch(); setEditingId(null); setCityFilter(""); onDayChange(Number(event.target.value)); }} className={inputStyle}>{days.map((item) => <option key={item.dayNumber} value={item.dayNumber}>第 {item.dayNumber} 天 · {item.date}</option>)}</select></label>
      <label className="min-w-44 text-sm text-graphite">地图范围<select aria-label="地图范围" value={filter} onChange={(event) => setCityFilter(event.target.value)} className={inputStyle}><option value="">当天全部地点 · 跨城概览</option>{cities.map((item) => <option key={item} value={item}>{item} · 城市详图</option>)}</select></label>
    </div>
    <MapCanvas places={places} />
    <p className="mt-2 text-sm leading-6 text-graphite">实心点：已确认地点；空心点：区域参考点。{dayPlaces.length === 0 ? "当天还没有已确认的地点，地图中不会放置推测标记。" : "可拖动地图，使用加减按钮或双指缩放。"}</p>
    <p className="mt-1 text-xs leading-6 text-graphite">免费地图 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap contributors</a> · 搜索 Nominatim。公共服务需联网，可能限流；请用公共地标代替私人住址。</p>
    {!plan.isCurrent ? <p className="my-3 rounded bg-shell p-3 text-sm">历史版本只读，地点保留当时的确认记录。</p> : null}
    <ul className="mt-4 grid gap-3 lg:grid-cols-2">
      {events.map((event) => {
        const place = plan.places?.find((item) => item.id === event.placeId);
        return <li key={event.id} className="rounded-md border border-sand p-4">
          <p className="text-sm text-graphite">{event.startTime}–{event.endTime}</p><h4 className="mt-1 font-semibold text-charcoal">{event.title}</h4>
          <p className="mt-1 break-words text-sm leading-6 text-charcoal">{place?.name ?? event.locationName ?? "尚未指定地点"}</p>
          <p className={`mt-1 text-sm ${place ? "text-sage" : "text-clay"}`}>{place ? place.precision === "area_reference" ? "区域参考点 · 并非已订酒店" : "用户已确认地点" : "待确认位置"}</p>
          {place ? <><p className="mt-1 break-words text-sm leading-6 text-graphite">{place.city} · {place.address}</p><p className="mt-1 text-xs leading-5 text-graphite">{place.source} · {place.coordinateSystem} · 查询于 {new Date(place.retrievedAt).toLocaleDateString("zh-CN")}</p></> : null}
          <button type="button" disabled={!plan.isCurrent || busy || event.locked || event.status === "confirmed"} className={`${actionStyle} mt-3`} aria-label={`定位：${event.title}`} onClick={() => { resetSearch(); setEditingId(event.id); setCity(place?.city ?? plan.requestSnapshot.destination ?? ""); setKeywords(place?.name ?? event.locationName ?? ""); setPrecision(place?.precision ?? (event.type === "accommodation" ? "area_reference" : "poi")); requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>{place ? "修改地点" : "搜索并定位"}</button>
          {event.locked || event.status === "confirmed" ? <p className="mt-1 text-xs text-graphite">先在时间轴解除锁定或确认，再修改地点。</p> : null}
        </li>;
      })}
    </ul>
    {editing ? <section ref={editor} className="mt-4 rounded-md border border-sage bg-sage-soft/40 p-4" aria-label={`定位 ${editing.title}`}>
      <h4 className="font-semibold text-charcoal">为“{editing.title}”确认地点</h4>
      <form className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto]" onSubmit={(event) => { event.preventDefault(); void search(); }}>
        <label className="text-sm font-medium">所在城市<input required value={city} maxLength={100} disabled={busy} className={inputStyle} onChange={(event) => { setCity(event.target.value); setCandidates([]); setSelectedToken(""); }} /></label>
        <label className="text-sm font-medium">地点名称或公共地标<input required value={keywords} maxLength={120} disabled={busy} className={inputStyle} onChange={(event) => { setKeywords(event.target.value); setCandidates([]); setSelectedToken(""); }} /></label>
        <button type="submit" disabled={busy} className={`${actionStyle} self-end bg-white`}><Search className="mr-1 inline size-4" />{busy ? "处理中…" : "搜索地点"}</button>
      </form>
      <p className="mt-3 text-sm leading-6 text-graphite" role="status">{feedback || "同名站点请核对完整名称与所在城市，例如深圳站和深圳北站。"}</p>
      <div className="mt-3 space-y-2">{candidates.map((candidate) => <label key={candidate.poiId} className="flex cursor-pointer items-start gap-3 rounded-md border border-sand bg-white p-3"><input type="radio" name="place-candidate" className="mt-1 size-5 shrink-0" checked={selectedToken === candidate.selectionToken} onChange={() => setSelectedToken(candidate.selectionToken)} disabled={busy} /><span className="min-w-0 break-words text-sm leading-6"><strong className="block">{candidate.name} · {candidate.city}</strong>{candidate.address}<span className="block text-xs text-graphite">{candidate.category} · {candidate.coordinateSystem}</span></span></label>)}</div>
      {selected ? <label className="mt-3 block text-sm">地点精度<select value={areaOnly ? "area_reference" : precision} disabled={busy || Boolean(areaOnly)} onChange={(event) => setPrecision(event.target.value as Place["precision"])} className={inputStyle}><option value="poi">准确地点（已核对具体站点／门店）</option><option value="area_reference">区域参考点（不是已订酒店）</option></select></label> : null}
      <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || !selected} onClick={() => void save()} className={`${actionStyle} bg-sage text-white`}>确认地点并保存新版本</button>
        {editing.placeId ? <button type="button" disabled={busy} onClick={() => void save(true)} className={actionStyle}>改为待确认位置</button> : null}
        <button type="button" disabled={busy} onClick={() => { resetSearch(); setEditingId(null); }} className={actionStyle}>保留原状并关闭</button>
        {busy && !saving ? <button type="button" onClick={() => { resetSearch(); setFeedback("已取消查询，原计划保持不变。"); }} className={actionStyle}>取消请求</button> : null}</div>
    </section> : null}
  </section>;
}
