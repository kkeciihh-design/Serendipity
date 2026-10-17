"use client";
import { businessFetch } from "@/lib/business-fetch";

import { useState, type FormEvent } from "react";
import type { RouteLeg } from "@/lib/routes";
import { chinaDateTimeInput, safeReferenceUrl } from "@/lib/transit-reference";
import type { PlanVersionClient } from "./plan-overview";

const inputStyle = "mt-1 min-h-12 min-w-0 w-full rounded-md border border-sand bg-white px-3 py-2 text-base text-charcoal disabled:opacity-60";

export function ManualTransitForm({ tripId, plan, fromEventId, toEventId, date, departureTime, route, disabled, onSaved }: {
  tripId: string;
  plan: PlanVersionClient;
  fromEventId: string;
  toEventId: string;
  date: string;
  departureTime: string;
  route?: RouteLeg;
  disabled: boolean;
  onSaved: (plan: PlanVersionClient) => void;
}) {
  const reference = route?.manualReference;
  const [availability, setAvailability] = useState<"available" | "no_service">(reference?.availability ?? "available");
  const [instructions, setInstructions] = useState(reference?.instructions ?? "");
  const [duration, setDuration] = useState(reference?.durationMinutes?.toString() ?? "");
  const [fare, setFare] = useState(reference?.fareCents === null || reference?.fareCents === undefined ? "" : (reference.fareCents / 100).toFixed(2));
  const [sourceName, setSourceName] = useState(reference?.sourceName ?? "高德地图");
  const [sourceUrl, setSourceUrl] = useState(reference?.sourceUrl ?? "");
  const [checkedAt, setCheckedAt] = useState(() => chinaDateTimeInput(reference?.checkedAt ?? new Date().toISOString()));
  const [acknowledged, setAcknowledged] = useState(false);
  const [acknowledgedDeparture, setAcknowledgedDeparture] = useState(departureTime);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  // A new departure requires another acknowledgement, while keeping the draft.
  if (acknowledgedDeparture !== departureTime) {
    setAcknowledgedDeparture(departureTime);
    setAcknowledged(false);
  }
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || saving) return;
    if (!acknowledged) { setFeedback("请先在外部地图核对当前日期和出发时刻，并勾选确认。"); return; }
    if (sourceUrl.trim() && !safeReferenceUrl(sourceUrl.trim())) { setFeedback("来源链接需为不含账号密码的 http 或 https 网址。"); return; }
    const readTime = new Date(`${checkedAt}:00+08:00`);
    if (!Number.isFinite(readTime.getTime()) || readTime.getTime() > Date.now() + 5 * 60 * 1000) { setFeedback("请填写真实查阅时间，不能晚于现在。"); return; }
    const steps = instructions.trim().split(/\r?\n/).filter((line) => line.trim());
    if (!steps.length || steps.length > 40 || steps.some((line) => line.trim().length > 240)) { setFeedback("请填写查阅到的线路步骤或停运说明，最多 40 行，每行不超过 240 字。"); return; }
    if (availability === "available" && fare && !/^\d+(?:\.\d{1,2})?$/.test(fare)) { setFeedback("票价最多填写两位小数，未知时请留空。"); return; }
    setSaving(true); setFeedback("正在保存人工参考…");
    try {
      const response = await businessFetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/routes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromEventId, toEventId, departureTime,
          manualReference: {
            availability, instructions: instructions.trim(),
            durationMinutes: availability === "available" && duration !== "" ? Number(duration) : null,
            fareCents: availability === "available" && fare !== "" ? Math.round(Number(fare) * 100) : null,
            sourceName: sourceName.trim(), sourceUrl: sourceUrl.trim() || null,
            checkedAt: readTime.toISOString(), acknowledged: true,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存人工参考失败。");
      setFeedback(`人工参考已保存至版本 ${data.plan.versionNumber}，实际运营仍需确认。`);
      onSaved(data.plan);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "保存失败，原计划已保留。");
    } finally { setSaving(false); }
  };
  return <form className="mt-3 rounded-md border border-sand bg-cream p-3" aria-label="公交人工参考" onSubmit={(event) => void save(event)}>
    <h6 className="font-semibold text-charcoal">记录人工参考</h6>
    <p className="mt-1 text-sm leading-6 text-graphite">适用日期与时刻：{date} {departureTime}（北京时间）。请记录线路、上下车站与换乘；总耗时包含步行、候车和换乘。未知项留空。</p>
    {reference ? <p className="mt-1 text-sm leading-6 text-clay">已带入原记录，保存前请重新查阅并确认当前时刻。原记录适用 {reference.date} {reference.departureTime}。</p> : null}
    <fieldset disabled={disabled || saving} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium sm:col-span-2">查询结果<select className={inputStyle} value={availability} onChange={(event) => { setAvailability(event.target.value as "available" | "no_service"); setAcknowledged(false); }}><option value="available">可用路线参考</option><option value="no_service">无路线／停运</option></select></label>
      <label className="min-w-0 text-sm font-medium sm:col-span-2">{availability === "available" ? "线路、换乘与步骤" : "无路线或停运说明"}<textarea required maxLength={2000} rows={4} value={instructions} className={`${inputStyle} leading-6`} placeholder={availability === "available" ? "例如：步行至 A 站 → 乘地铁 1 号线 → B 站换乘 → C 站下车" : "记录查询时显示无方案、末班车已过等信息；无法判断时请说明原因。"} onChange={(event) => setInstructions(event.target.value)} /></label>
      {availability === "available" ? <>
        <label className="min-w-0 text-sm font-medium">总耗时（分钟，可留空）<input type="number" min={1} max={1440} step={1} value={duration} className={inputStyle} onChange={(event) => setDuration(event.target.value)} /></label>
        <label className="min-w-0 text-sm font-medium">每人票价（元，可留空）<input type="number" min={0} max={10000} step="0.01" value={fare} className={inputStyle} onChange={(event) => setFare(event.target.value)} /></label>
      </> : null}
      <label className="min-w-0 text-sm font-medium">来源名称<input required maxLength={120} value={sourceName} className={inputStyle} onChange={(event) => setSourceName(event.target.value)} /></label>
      <label className="min-w-0 text-sm font-medium">查阅时间（北京时间）<input required type="datetime-local" value={checkedAt} className={inputStyle} onChange={(event) => { setCheckedAt(event.target.value); setAcknowledged(false); }} /></label>
      <label className="min-w-0 text-sm font-medium sm:col-span-2">来源链接（可选）<input type="url" maxLength={2000} value={sourceUrl} placeholder="https://…" className={inputStyle} onChange={(event) => setSourceUrl(event.target.value)} /></label>
      <label className="flex min-w-0 items-start gap-3 text-sm leading-6 sm:col-span-2"><input required type="checkbox" checked={acknowledged} className="mt-1 size-5 shrink-0" onChange={(event) => setAcknowledged(event.target.checked)} /><span>我已在外部地图按 {date} {departureTime} 核对，并知晓这是人工参考，实际运营仍需确认。</span></label>
      <button type="submit" className="min-h-12 rounded-md bg-sage px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2" disabled={disabled || saving || !acknowledged}>{saving ? "保存中…" : reference ? "重新确认并保存" : "保存人工参考"}</button>
    </fieldset>
    {feedback ? <p className="mt-2 break-words text-sm leading-6 text-graphite" role="status">{feedback}</p> : null}
  </form>;
}
