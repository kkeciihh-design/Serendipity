import type { RouteLeg, RouteMode } from "@/lib/routes";
import { chinaDateTimeInput, formatRouteFare, safeReferenceUrl } from "@/lib/transit-reference";

export const routeModeLabels: Record<RouteMode, string> = {
  walking: "步行",
  public_transit: "地铁/公交",
  driving: "驾车/打车",
};
const statusLabels: Record<RouteLeg["status"], string> = {
  verified: "已核实",
  estimated: "估算",
  pending_confirmation: "待确认",
  unavailable: "暂无可用路线",
};
function durationLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60 ? `${minutes % 60} 分钟` : ""}`.trim();
}
function distanceLabel(meters: number) {
  return meters >= 1_000 ? `${(meters / 1_000).toFixed(meters >= 10_000 ? 0 : 1)} 公里` : `${meters} 米`;
}
export function RouteSummary({ route, selectionChanged = false, compact = false }: { route: RouteLeg; selectionChanged?: boolean; compact?: boolean }) {
  const reference = route.manualReference;
  const stale = Boolean(reference?.requiresReconfirmation || selectionChanged);
  const sourceUrl = safeReferenceUrl(reference?.sourceUrl);
  const unavailable = reference?.availability === "no_service" || route.status === "unavailable";
  const status = reference
    ? stale ? "人工参考 · 需重新核实" : unavailable ? "人工记录：无路线／停运 · 待确认" : "人工参考 · 待确认"
    : stale ? "原路线 · 需重新查询" : statusLabels[route.status];
  const fare = reference?.fareCents !== undefined ? reference.fareCents : route.cost.minCents;
  const fareLabel = !reference && route.cost.minCents !== route.cost.maxCents && route.cost.minCents !== null && route.cost.maxCents !== null
    ? `${formatRouteFare(route.cost.minCents)}–${formatRouteFare(route.cost.maxCents)}`
    : formatRouteFare(fare);
  const referenceSeconds = reference?.durationMinutes ? reference.durationMinutes * 60 : null;
  const seconds = reference ? referenceSeconds : route.durationSeconds;
  return <div className="mt-3 min-w-0 break-words rounded-md bg-cream p-3 text-sm leading-6">
    <p className="font-semibold text-charcoal">{routeModeLabels[route.mode]}｜{status}{!unavailable && seconds !== null ? `｜${stale ? "原参考耗时 " : ""}${durationLabel(seconds)}` : ""}{!reference && !compact && !unavailable && route.distanceMeters !== null && route.distanceMeters > 0 ? `｜${distanceLabel(route.distanceMeters)}` : ""}</p>
    <p className="text-graphite">{stale ? "原记录适用" : "适用"}：{reference?.date ?? route.date} {reference?.departureTime ?? route.departureTime}（北京时间）{!reference && !unavailable ? `｜有效时刻 ${route.validFromTime}–${route.validUntilTime}` : ""}</p>
    {!unavailable ? <p className="text-graphite">{!stale && route.arrivalDate && route.arrivalTime ? `参考到达 ${route.arrivalDate} ${route.arrivalTime}｜` : ""}{seconds === null ? "耗时未知｜" : ""}{stale ? "原记录" : ""}{route.mode === "public_transit" ? "每人票价" : "费用"}：{fareLabel}</p> : <p className="text-graphite">{stale ? "原记录显示无路线或停运，请按新日期与时刻重新查阅。" : "该时刻记录为无路线或停运，实际运营情况仍需确认。"}</p>}
    {reference ? <>
      <p className="text-graphite">人工录入参考，不支持自动查询未来班次；更换日期、地点或时刻后须重新查阅。</p>
      <p className="text-graphite">来源：{reference.sourceName}{sourceUrl ? <> · <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sage underline">查看来源</a></> : null}｜查阅于 {chinaDateTimeInput(reference.checkedAt).replace("T", " ")}（北京时间）</p>
    </> : <>
      <p className="text-graphite">{route.scheduleBasis}</p>
      <p className="text-graphite">{route.futureQueryCapability ? "支持按未来时刻查询" : "缺少未来时刻能力，结果仅适用于本次出发时刻"}｜来源：{route.source}</p>
      {!compact && route.candidateRecheck.status !== "not_applicable" ? <p className="text-graphite">候选复核：{route.candidateRecheck.attempts} 轮｜{route.candidateRecheck.reason}</p> : null}
    </>}
    {route.conflict ? <p className="font-medium text-clay">{route.conflict}</p> : null}
    {reference ? <details className="mt-2"><summary className="cursor-pointer text-sage">查看人工记录</summary><p className="mt-2 whitespace-pre-wrap text-graphite">{reference.instructions}</p></details> : route.steps.length ? <details className="mt-2"><summary className="cursor-pointer text-sage">查看路线步骤</summary><ol className="mt-2 space-y-1 text-graphite">{route.steps.map((step, index) => <li key={`${route.id}-${index}`}>{index + 1}. {step.instruction}{step.durationSeconds ? `｜${durationLabel(step.durationSeconds)}` : ""}{step.line ? `｜${step.line}` : ""}{step.departureTime ? `｜${step.departureTime} 上车` : ""}{step.arrivalTime ? `｜${step.arrivalTime} 下车` : ""}</li>)}</ol></details> : <p className="mt-2 text-graphite">没有可用步骤。</p>}
  </div>;
}
