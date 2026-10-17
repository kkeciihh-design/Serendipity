"use client";
import { businessFetch } from "@/lib/business-fetch";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, MapPin, Route, Search } from "lucide-react";
import type { Place, SignedPlaceCandidate } from "@/lib/places";
import { buildPlanOverviewDays } from "@/lib/plan-overview";
import { buildMapMarkers, buildMapRoutes, numberPlanEvents } from "@/lib/map-link";
import type { RouteMode } from "@/lib/routes";
import { cityRouteOriginIssue } from "@/lib/route-origin";
import { routeDayEvents } from "@/lib/route-day";
import { buildAmapTransitLink } from "@/lib/transit-reference";
import type { PlanVersionClient } from "./plan-overview";
import { MapCanvas } from "./map-canvas";
import { ManualTransitForm } from "./manual-transit-form";
import { RouteSummary, routeModeLabels } from "./route-summary";

const inputStyle = "mt-1 min-h-12 min-w-0 w-full rounded-md border border-sand bg-cream px-3 py-2 text-base text-charcoal";
const actionStyle = "min-h-12 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage disabled:opacity-50";

export type MapLinkTarget = "map" | "timeline" | "transport";

export function PlanMap({ tripId, plan, onSaved, selectedDayNumber, onDayChange, selectedEventId, onEventSelect }: {
  tripId: string;
  plan: PlanVersionClient;
  onSaved: (plan: PlanVersionClient) => void;
  selectedDayNumber: number;
  onDayChange: (day: number) => void;
  selectedEventId: string | null;
  onEventSelect: (eventId: string, target: MapLinkTarget, dayNumber: number) => void;
}) {
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
  const [routeBusyKey, setRouteBusyKey] = useState<string | null>(null);
  const [routeModes, setRouteModes] = useState<Record<string, RouteMode>>({});
  const [routeDepartures, setRouteDepartures] = useState<Record<string, string>>({});
  const [routeFeedback, setRouteFeedback] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const events = useMemo(() => numberPlanEvents(routeDayEvents(plan.events, plan.events.find((event) => event.dayNumber === day)?.date ?? "")), [plan.events, day]);
  const dayPlaces = (plan.places ?? []).filter((place) => events.some((item) => item.event.placeId === place.id));
  const cities = [...new Set(dayPlaces.map((place) => place.city))];
  const filter = cities.includes(cityFilter) ? cityFilter : "";
  const markers = useMemo(() => buildMapMarkers(
    events.map((item) => item.event),
    (plan.places ?? []).filter((place) => !filter || place.city === filter),
  ), [events, plan.places, filter]);
  const mapRoutes = useMemo(() => buildMapRoutes((plan.routeLegs ?? []).filter((route) => {
    if (cityRouteOriginIssue(plan.events.find((event) => event.id === route.fromEventId))) return false;
    const key = `${route.fromEventId}->${route.toEventId}`;
    return (!routeModes[key] || routeModes[key] === route.mode) && (!routeDepartures[key] || routeDepartures[key] === route.departureTime);
  }), markers), [plan.routeLegs, plan.events, routeModes, routeDepartures, markers]);
  const placedEvents = events.filter((item) => item.event.placeId);
  const routePairs = placedEvents.slice(0, -1).map((item, index) => ({
    from: item,
    to: placedEvents[index + 1],
    key: `${item.event.id}->${placedEvents[index + 1].event.id}`,
  }));
  const editing = events.find((item) => item.event.id === editingId)?.event;
  const selected = candidates.find((candidate) => candidate.selectionToken === selectedToken);
  const areaOnly = selected && /地名地址|行政地名|boundary:|place:(city|town|village|suburb|neighbourhood|quarter|county|state)/.test(selected.category);
  const resetSearch = () => { controller.current?.abort(); setCandidates([]); setSelectedToken(""); setFeedback(""); setBusy(false); };
  const selectEvent = useCallback((eventId: string) => {
    const event = plan.events.find((item) => item.id === eventId);
    if (event) onEventSelect(eventId, "timeline", event.dayNumber);
  }, [onEventSelect, plan.events]);

  const search = async () => {
    if (!editing) return;
    const active = new AbortController(); controller.current?.abort(); controller.current = active;
    setBusy(true); setCandidates([]); setSelectedToken(""); setFeedback("正在搜索地点…");
    try {
      const response = await businessFetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/places`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: editing.id, city, keywords }), signal: active.signal });
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
      const response = await businessFetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/places`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: editing.id, selectionToken: remove ? null : selectedToken, precision: areaOnly ? "area_reference" : precision }), signal: active.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存地点失败。");
      if (!active.signal.aborted) onSaved(data.plan);
    } catch (error) { if (!active.signal.aborted) setFeedback(error instanceof Error ? error.message : "保存失败，原计划已保留。"); }
    finally { if (!active.signal.aborted) { setBusy(false); setSaving(false); } }
  };
  const queryRoute = async (fromId: string, toId: string, mode: RouteMode, departureTime: string) => {
    if (!plan.isCurrent || mode === "public_transit") return;
    const key = `${fromId}->${toId}`;
    setRouteBusyKey(key);
    setRouteFeedback((current) => ({ ...current, [key]: "正在查询适用时刻的路线…" }));
    try {
      const response = await businessFetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromEventId: fromId,
          toEventId: toId,
          mode,
          departureTime,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "路线查询失败。");
      setRouteFeedback((current) => ({ ...current, [key]: "" }));
      onSaved(data.plan);
    } catch (error) {
      setRouteFeedback((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "路线查询失败，原计划已保留。",
      }));
    } finally {
      setRouteBusyKey(null);
    }
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
    <MapCanvas markers={markers} routes={mapRoutes} focusEventId={selectedEventId} onEventSelect={selectEvent} />
    <p className="mt-2 text-sm leading-6 text-graphite">实心点：已确认地点；空心点：区域参考点。{dayPlaces.length === 0 ? "当天还没有已确认的地点，地图中不会放置推测标记。" : "可拖动地图，使用加减按钮或双指缩放。"}</p>
    {events.some((item) => item.visitLabel === "宿") && <p className="mt-2 text-sm text-graphite">“宿”表示从前晚住宿出发，不占用当天日程编号；查看日程会返回对应住宿那一晚。</p>}
    <p className="mt-1 text-xs leading-6 text-graphite">免费地图 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap contributors</a> · 搜索 Nominatim。公共服务需联网，可能限流；请用公共地标代替私人住址。</p>
    {(plan.tickets ?? []).some((ticket) => ticket.status === "active" && ticket.confirmedAt) ? <section aria-label="跨城交通示意" className="mt-4 rounded-md border border-sand bg-cream p-4">
      <h4 className="text-sm font-semibold">跨城交通 · 站点示意</h4>
      <p className="mt-1 text-xs leading-5 text-graphite">以下来自已确认票面；没有实际轨迹时不绘制城际导航路线。接驳与返家环节见门到门交通。</p>
      <ul className="mt-2 space-y-2">{(plan.tickets ?? []).filter((ticket) => ticket.status === "active" && ticket.confirmedAt).map((ticket) => <li key={ticket.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words">{ticket.direction === "departure" ? "去程" : "返程"} · {ticket.serviceNumber || "班次待补"}：{ticket.fromName || "出发站待补"}{ticket.fromDetail ? ` ${ticket.fromDetail}` : ""} → {ticket.toName || "到达站待补"}{ticket.toDetail ? ` ${ticket.toDetail}` : ""}</span><button type="button" className={actionStyle} onClick={() => onEventSelect(ticket.eventId, "transport", plan.events.find((event) => event.id === ticket.eventId)?.dayNumber ?? day)}>查看交通票面</button></li>)}</ul>
    </section> : null}
    <section className="mt-5" aria-label="城市路线">
      <h4 className="flex items-center gap-2 text-base font-semibold text-charcoal"><Route className="size-5 text-sage" />当天相邻地点路线</h4>
      <div className="mt-3 grid gap-3">
        {routePairs.length === 0 ? <p className="rounded-md bg-shell px-4 py-3 text-sm text-graphite">至少确认两个地点后可查询路线。</p> : null}
        {routePairs.map(({ from, to, key }) => {
          const route = (plan.routeLegs ?? []).find((item) => item.fromEventId === from.event.id && item.toEventId === to.event.id);
          const originIssue = cityRouteOriginIssue(from.event);
          if (originIssue) return <article key={key} className="min-w-0 rounded-md border border-sand bg-white p-4">
            <h5 className="text-sm font-semibold text-charcoal">{from.visitLabel}{from.event.title} → {to.visitLabel}{to.event.title}</h5>
            <p className="mt-2 text-sm leading-6 text-clay">{originIssue}</p>
            {route ? <p className="mt-2 text-sm text-graphite">原路线起点不适用，耗时、到达和地图折线不再作为衔接依据。{!plan.isCurrent ? "历史费用保留原记录。" : "未确认路线费用需重新核对，已确认或已支付金额保留。"}</p> : null}
            <button type="button" className={`${actionStyle} mt-3`} onClick={() => onEventSelect(from.event.id, "transport", from.event.dayNumber)}>核对门到门后段接驳</button>
          </article>;
          const mode = routeModes[key] ?? route?.mode ?? "walking";
          const date = from.event.date;
          const sameDayConnection = (!from.event.endDate || from.event.endDate === date) && to.event.date === date;
          const departureTime = routeDepartures[key] ?? (route?.manualReference?.requiresReconfirmation ? from.event.endTime : route?.departureTime) ?? from.event.endTime;
          const busyRoute = routeBusyKey === key;
          const selectionChanged = Boolean(route && (route.mode !== mode || route.departureTime !== departureTime || route.date !== date));
          const fromPlace = plan.places?.find((place) => place.id === from.event.placeId);
          const toPlace = plan.places?.find((place) => place.id === to.event.placeId);
          const externalLink = fromPlace && toPlace ? buildAmapTransitLink(fromPlace, toPlace) : null;
          return <article key={key} className="min-w-0 rounded-md border border-sand bg-white p-4">
            <h5 className="text-sm font-semibold text-charcoal">{from.visitLabel}{from.event.title} → {to.visitLabel}{to.event.title}</h5>
            <form className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,150px)_minmax(0,150px)_minmax(0,1fr)]" onSubmit={(event) => { event.preventDefault(); void queryRoute(from.event.id, to.event.id, mode, departureTime); }}>
              <label className="min-w-0 text-sm font-medium">交通方式<select value={mode} disabled={busyRoute || !plan.isCurrent} className={inputStyle} onChange={(event) => { setRouteModes((current) => ({ ...current, [key]: event.target.value as RouteMode })); setRouteFeedback((current) => ({ ...current, [key]: "" })); }}>
                {(Object.keys(routeModeLabels) as RouteMode[]).map((item) => <option key={item} value={item}>{routeModeLabels[item]}</option>)}
              </select></label>
              <label className="min-w-0 text-sm font-medium">出发时刻<input required type="time" value={departureTime} min={from.event.endTime} disabled={busyRoute || !plan.isCurrent} className={inputStyle} onChange={(event) => { setRouteDepartures((current) => ({ ...current, [key]: event.target.value })); setRouteFeedback((current) => ({ ...current, [key]: "" })); }} /></label>
              {mode !== "public_transit" ? <button type="submit" disabled={busyRoute || !plan.isCurrent || !sameDayConnection} className={`${actionStyle} self-end bg-sage text-white`}>{busyRoute ? "查询中…" : "查询并保存"}</button> : null}
            </form>
            {!sameDayConnection ? <p className="mt-2 text-sm leading-6 text-clay">上一项跨日结束或下一项不在同一天；当前城市路线仅支持同日衔接，请在同一天的地点之间记录路线。</p> : null}
            {!departureTime || departureTime < from.event.endTime ? <p className="mt-2 text-sm leading-6 text-clay">请填写有效出发时刻，不能早于上一项结束时间 {from.event.endTime}。</p> : null}
            {mode === "public_transit" ? <div className="mt-3 rounded-md bg-sage-soft/50 p-3 text-sm leading-6">
              <p className="font-medium text-charcoal">公交／地铁通过外部地图查阅，再手动保存参考。</p>
              {externalLink ? <a href={externalLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center rounded-md border border-sage bg-white px-3 py-2 font-semibold text-sage">在高德查看公交路线</a> : null}
              <p className="mt-2 text-graphite">打开后请核对起终点，并自行选择 {date} {departureTime}（北京时间）；链接只传入地点，不会自动设置日期和时刻，查询结果也不会自动回传。</p>
              <p className="mt-1 text-graphite">点击后会将这两个地点交给高德地图查询，无需配置 API Key。本站不会自动查询公交班次，也不会依据人工记录绘制路线折线。</p>
            </div> : null}
            {selectionChanged ? <p className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6 text-clay" role="status">当前选择已变化，下面保留的是原记录，不适用于当前选择。请按新时刻重新核实并保存。</p> : null}
            {route ? <RouteSummary route={route} selectionChanged={selectionChanged} /> : null}
            {mode === "public_transit" ? <ManualTransitForm key={`${plan.id}/${key}/${date}`} tripId={tripId} plan={plan} fromEventId={from.event.id} toEventId={to.event.id} date={date} departureTime={departureTime} route={route} disabled={!plan.isCurrent || busyRoute || !sameDayConnection || !departureTime || departureTime < from.event.endTime} onSaved={onSaved} /> : null}
            {routeFeedback[key] ? <p className="mt-2 text-sm text-graphite" role="status">{routeFeedback[key]}</p> : null}
          </article>;
        })}
      </div>
    </section>
    {!plan.isCurrent ? <p className="my-3 rounded bg-shell p-3 text-sm">历史版本只读，地点保留当时的确认记录。</p> : null}
    <ul className="mt-4 grid gap-3 lg:grid-cols-2">
      {events.map(({ event, visitLabel }) => {
        const place = plan.places?.find((item) => item.id === event.placeId);
        return <li key={event.id} className={`rounded-md border p-4 ${selectedEventId === event.id ? "border-sage bg-sage-soft" : "border-sand bg-white"}`}>
          <p className="text-sm text-graphite"><span aria-hidden="true" className="mr-2 font-semibold text-sage">{visitLabel}</span>{event.ticketTimingPending ? "票面时刻待补 / 冲突" : `${event.startTime}–${event.endTime}`}</p>
          <h4 className="mt-1 font-semibold text-charcoal">{event.title}</h4>
          <p className="mt-1 break-words text-sm leading-6 text-charcoal">{place?.name ?? event.locationName ?? "尚未指定地点"}</p>
          <p className={`mt-1 text-sm ${place ? "text-sage" : "text-clay"}`}>{place ? place.precision === "area_reference" ? "区域参考点 · 并非已订酒店" : "用户已确认地点" : "待确认位置"}</p>
          {place ? <><p className="mt-1 break-words text-sm leading-6 text-graphite">{place.city} · {place.address}</p><p className="mt-1 text-xs leading-5 text-graphite">{place.source} · {place.coordinateSystem} · 查询于 {new Date(place.retrievedAt).toLocaleDateString("zh-CN")}</p></> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={`${actionStyle} inline-flex items-center gap-2`} aria-label={`查看日程：${visitLabel}${event.title}`} title={`查看日程：${visitLabel}${event.title}`} onClick={() => onEventSelect(event.id, "timeline", event.dayNumber)}><CalendarClock className="size-4" />查看日程</button>
            <button type="button" disabled={!plan.isCurrent || busy || event.locked || event.status === "confirmed"} className={`${actionStyle} inline-flex items-center gap-2`} aria-label={`定位：${event.title}`} onClick={() => { resetSearch(); setEditingId(event.id); setCity(place?.city ?? plan.requestSnapshot.destination ?? ""); setKeywords(place?.name ?? event.locationName ?? ""); setPrecision(place?.precision ?? (event.type === "accommodation" ? "area_reference" : "poi")); requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }}><MapPin className="size-4" />{place ? "修改地点" : "搜索并定位"}</button>
          </div>
          {event.ticketManaged ? <p className="mt-1 text-xs text-graphite">地点由有效票面约束，变更请到门到门交通管理票据。</p> : event.locked || event.status === "confirmed" ? <p className="mt-1 text-xs text-graphite">先在时间轴解除锁定或确认，再修改地点。</p> : null}
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
