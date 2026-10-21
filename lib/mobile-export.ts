import { normalizeRouteStopKey, renderGeographicMap } from "./export-map";
import { getTripHardTimeConstraints } from "./trip-hard-constraints";
import { exportPrivacy } from "./export-privacy";
import { projectExportWeather } from "./export-advisories";
import { projectPreparation } from "./export-preparation";
import { calculateBudgetSummary, costCategoryLabels, eventCostSummary, formatMoneyRange } from "./budget";
import { evidenceFieldLabels, evidenceStatusLabels } from "./evidence";
import { formatPlanDate, planEventEnd, sortPlanEvents, type PlanEvent } from "./plan";
import { formatBudgetTarget, formatRequestDateRange, formatTravelerCount } from "./plan-overview";
import { formatRedlineTime } from "./redlines";
import { routeModeLabels } from "./routes";
import { isActiveTicket } from "./tickets";
import { ExportError, mobileExportOptionsSchema, type ExportSnapshot, type MobileExportOptions } from "./export-snapshot";

export const MOBILE_HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const escape = (v: string) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const modeLabel = (mode: string | null) => mode === "walking" ? "步行" : mode === "driving" ? "驾车 / 打车" : mode === "public_transit" ? "公共交通" : "交通方式待确认";
const minutes = (seconds: number | null) => seconds === null ? "耗时待确认" : `约 ${Math.ceil(seconds / 60)} 分钟`;
const eventCostLabel = (minCents: number | null, maxCents: number | null) => {
  if (minCents === null) return "以现场为准";
  if (minCents === 0 && (maxCents ?? 0) === 0) return "免费";
  return `¥${formatMoneyRange(minCents, maxCents).replace(/ 元$/, "")}`;
};

export function renderMobileHtml(snapshot: ExportSnapshot, rawOptions: MobileExportOptions, visuals: { includeMap?: boolean } = {}): string {
  const options = mobileExportOptionsSchema.parse(rawOptions), { plan } = snapshot;
  const allEvents = sortPlanEvents(plan.events), allDates = [...new Set(allEvents.map((e) => e.date))];
  const dates = options.dates === null ? allDates : allDates.filter((d) => options.dates!.includes(d));
  if (!dates.length || options.dates?.some((d) => !allDates.includes(d))) throw new ExportError("所选日期不属于这份已保存计划，请重新读取后选择。");
  const { text: t, privateIds } = exportPrivacy(snapshot, options);
  const p = (s: string, cls = "") => `<p${cls ? ` class="${cls}"` : ""}>${t(s)}</p>`;
  const list = (items: string[]) => items.length ? `<ul>${items.map((i) => `<li>${t(i)}</li>`).join("")}</ul>` : "";
  const selected = allEvents.filter((e) => dates.includes(e.date));
  const selectedEventIds = new Set(selected.map((event) => event.id));
  const eventTime = (e: PlanEvent) => `${e.startTime}–${formatPlanDate(planEventEnd(e)) !== e.date ? `${formatPlanDate(planEventEnd(e))} ` : ""}${e.endTime}`;
  const hasPrivateAddress = privateIds.size > 0;
  const hasSeats = plan.tickets.some((ticket) => ticket.seat);
  const publicLabel = !options.includePrivateAddress && hasPrivateAddress && options.publicLandmark ? `附近公共地标：${options.publicLandmark}。该地标仅供辨认，未按它重新计算接驳或红线。` : "";
  const privateNotice = hasPrivateAddress
    ? options.includePrivateAddress
      ? "本文件包含私人地址，请妥善保存。"
      : "私人起终点已隐藏；红线仍按原起点计算，出发前请核对自己的位置。"
    : "";
  const seatNotice = hasSeats
    ? options.includeSeats
      ? "已选择带出座位。"
      : "座位已隐藏。"
    : "";
  const progress = snapshot.execution;
  const current = allEvents.find((e) => e.id === progress.currentEventId);
  const done = new Set(progress.items.filter((i) => i.completedAt).map((i) => i.eventId));
  const executionNote = progress.endedAt ? "截至导出，已手动记录全部完成。" : progress.startedAt ?
    `截至导出，已手动记录完成 ${allEvents.filter((e) => done.has(e.id)).length} / ${allEvents.length} 项；当时当前步骤：${current?.title ?? "待选择"}。` : "";
  const hardTimes = getTripHardTimeConstraints(plan.requestSnapshot).filter((constraint) => dates.includes(constraint.date));
  const budget = calculateBudgetSummary(plan.costs, plan.requestSnapshot);
  const redlines = snapshot.redlines.filter((r) => selected.some((e) => e.id === r.input.eventId) || r.suggestedAt && dates.includes(formatPlanDate(new Date(r.suggestedAt))));
  const renderRedline = (r: ExportSnapshot["redlines"][number]) => {
    const event = allEvents.find((e) => e.id === r.input.eventId), date = event?.date;
    const route = r.suggestedCheck?.route ?? r.input.route;
    return `<article class="redline"><h3>${t(r.input.direction === "departure" ? "去程出门红线" : "返程出发红线")}</h3>
      <p class="deadline">${t(formatRedlineTime(r.suggestedAt, date))}</p>
      ${p(`前往 ${r.input.destination} · ${r.precision === "verified" ? "导出时资料已核验" : r.precision === "estimated" ? "估算，出发前复核" : "待确认，不保证可行"}`)}
      ${p(`原起点：${r.input.origin}。${r.reason}`)}
      ${p(`接驳 ${minutes(route.durationSeconds)}；办理 ${minutes(r.input.steps.reduce((sum, s) => sum + s.seconds, 0))}；额外缓冲 ${minutes(r.bufferSeconds)}。`)}
      ${list(r.input.deadlines.map((d) => `${d.label}：${formatRedlineTime(d.at, date)} · ${d.source}`))}
      ${list([...r.conflicts, ...r.input.blockers])}
      ${p(`路线依据：${!options.includePrivateAddress && r.input.direction === "departure" ? "原起点接驳参考，私人路线细节已省略" : route.source}；${route.kind === "timed" ? "班次与路况依赖时刻，离线不能重新查询。" : "固定耗时参考。"}`, "muted")}
      ${list(r.input.assumptions)}
      ${done.has(r.input.eventId) ? p("截至导出，此交通已手动标记完成。", "muted") : ""}</article>`;
  };
  const renderEvent = (e: PlanEvent, index: number) => {
    const next = allEvents[allEvents.findIndex((event) => event.id === e.id) + 1];
    const record = progress.items.find((i) => i.eventId === e.id);
    const incoming = plan.routeLegs.filter((r) => r.toEventId === e.id);
    const tickets = plan.tickets.filter((ticket) => ticket.eventId === e.id && isActiveTicket(ticket));
    const location = !options.includePrivateAddress && privateIds.has(e.id) ? "私人地点已隐藏" : e.locationName || "地点待确认";
    const routes = incoming.map((r) => {
      const origin = allEvents.find((event) => event.id === r.fromEventId);
      const privateRoute = !options.includePrivateAddress && (privateIds.has(e.id) || origin && privateIds.has(origin.id));
      return `${p(`到这里：${origin?.locationName ?? "起点待确认"} → ${location}；${routeModeLabels[r.mode]}，${minutes(r.durationSeconds)}。`)}
        ${p(`路线${r.status === "verified" ? "导出时已核验" : "待复核 / 估算"}；参考出发 ${r.date} ${r.departureTime}；${privateRoute ? "私人路线说明已省略" : r.scheduleBasis}`)}
        ${privateRoute ? p("私人起点路线细节已省略，耗时保留原参考。") : list(r.steps.map((s) => s.instruction))}
        ${p(`来源：${privateRoute ? "原计划接驳资料" : r.source} · 获取于 ${formatRedlineTime(r.retrievedAt)}`, "muted")}`;
    }).join("");
    const ticketDetails = tickets.map((ticket) => `${p(`${ticket.mode === "train" ? "高铁 / 火车" : "航班"} ${ticket.serviceNumber ?? "班次待补"} · ${ticket.fromName ?? "出发站待补"} → ${ticket.toName ?? "到达站待补"} · 用户已确认票面`)}
      ${p(`发车 / 起飞 ${ticket.date ?? "日期待补"} ${ticket.departureTime ?? "时刻待补"}；到达 ${ticket.arrivalDate ?? "日期待补"} ${ticket.arrivalTime ?? "时刻待补"}`)}
      ${p(`出发接驳：${ticket.chainOriginName ?? "起点待补"} → ${ticket.fromName ?? "车站 / 机场"}；${modeLabel(ticket.accessMode)}，${minutes(ticket.accessDurationMinutes === null ? null : ticket.accessDurationMinutes * 60)}，人工参考待核实。`)}
      ${p(`到达接驳：${ticket.toName ?? "车站 / 机场"} → ${ticket.chainDestinationName ?? "终点待补"}；${modeLabel(ticket.egressMode)}，${minutes(ticket.egressDurationMinutes === null ? null : ticket.egressDurationMinutes * 60)}，人工参考待核实。`)}
      ${ticket.baggageNote ? p(`行李：${ticket.baggageNote}`) : ""}
      ${options.includeSeats && ticket.seat ? p(`座位：${ticket.seat}`) : ""}`).join("");
    const facts = snapshot.evidence.filter((f) => f.eventId === e.id);
    const accommodation = e.accommodationSelection;
    const cost = eventCostSummary(e.id, plan.costs, plan.requestSnapshot);
    return `<li class="event"><div class="event-head"><span class="number">${e.dayNumber}.${index + 1}</span><p class="time">${t(eventTime(e))}</p></div>
      <h3>${t(e.title)}</h3>${p(location, "location")}
      ${p(`${cost ? eventCostLabel(cost.minCents, cost.maxCents) : "以现场为准"}${e.locked ? " · 已锁定" : ""}`, "cost-line")}
      ${record?.completedAt ? p(`已手动完成 · ${formatRedlineTime(record.completedAt)}`, "record") : record?.arrivedAt ? p(`已手动到达 · ${formatRedlineTime(record.arrivedAt)}`, "record") : ""}
      ${e.note ? p(e.note) : ""}${routes}${ticketDetails}
      ${accommodation ? p(`住宿 ${accommodation.checkIn} 至 ${accommodation.checkOut}，${accommodation.roomCount} 间 / ${accommodation.nightCount} 晚；入住 ${accommodation.checkInFrom ?? "待确认"}，退房 ${accommodation.checkOutBy ?? "待确认"}；寄存${accommodation.luggageStorage === "available" ? "用户记录可用" : accommodation.luggageStorage === "unavailable" ? "不可用" : "待确认"}。${accommodation.conditionNote}`) : ""}
      ${facts.length ? `<details><summary>来源与待核对资料（${facts.length}）</summary>${list(facts.map((f) => `${evidenceFieldLabels[f.field]} · ${evidenceStatusLabels[f.status]}：${f.value}。${f.source}；获取 ${formatRedlineTime(f.retrievedAt)}；适用 ${formatRedlineTime(f.applicableFrom)} 至 ${formatRedlineTime(f.applicableUntil)}。`))}</details>` : ""}
      <p class="next">${t(next ? `下一步：${next.date === e.date ? "" : `${next.date} `}${next.startTime} ${next.title}${dates.includes(next.date) ? "" : "（该日未选入本文件）"}` : "下一步：本次行程结束，核对返家安排。")}</p></li>`;
  };
  const preparation = projectPreparation(snapshot, dates, selectedEventIds, allDates);
  const title = snapshot.tripTitle ?? `${plan.requestSnapshot.destination ?? "旅行"} · 随身一页`;
  const dayRoute = (date: string) => {
    const seenStops = new Set<string>();
    const stops = selected
      .filter((event) => event.date === date)
      .map((event) => !options.includePrivateAddress && privateIds.has(event.id)
        ? "私人地点"
        : event.locationName || event.title)
      .filter((stop) => {
        const key = normalizeRouteStopKey(stop);
        if (seenStops.has(key)) return false;
        seenStops.add(key);
        return true;
      });
    return `<div class="day-route"><p>当日动线</p><div>${stops.map((stop) => `<span>${t(stop)}</span>`).join('<span class="route-arrow" aria-hidden="true">→</span>')}</div></div>`;
  };
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(MOBILE_HTML_CSP)}"><meta name="referrer" content="no-referrer"><title>${t(title)}</title>
<style>${MOBILE_CSS}</style></head><body><header id="top"><p class="eyebrow">SERENDIPITY / 随身旅行路书</p><h1>${t(title)}</h1>
<div class="cover-meta"><span>${t(formatRequestDateRange(plan.requestSnapshot))}</span><span>${t(formatTravelerCount(plan.requestSnapshot))}</span><span>${t(formatBudgetTarget(plan.requestSnapshot))}</span><span>已知费用 ${t(formatMoneyRange(budget.totalMinCents, budget.totalMaxCents))}</span></div>
${hardTimes.map((constraint) => `<p class="deadline-pill">${t(`${constraint.date} ${constraint.label}`)}</p>`).join("")}
<p class="cover-note">生成于 ${t(formatRedlineTime(snapshot.generatedAt))}（北京时间） · 离线静态资料，不会自动更新</p>
${!snapshot.requirementUpToDate ? p("计划待更新：最新需求尚未应用。本文件日期、人数和预算仍使用这份计划自己的需求依据。", "warning") : ""}
${privateNotice ? p(privateNotice) : ""}${publicLabel ? p(publicLabel) : ""}${seatNotice ? p(seatNotice, "muted") : ""}
</header><nav aria-label="日期导航">${dates.map((d) => `<a href="#day-${d}">${t(`${d.slice(5)} · 第${allEvents.find((e) => e.date === d)!.dayNumber}天`)}</a>`).join("")}<a href="#redlines">红线</a><a href="#preparation">行前核对</a></nav>
<main><section aria-label="出发前速读"><h2>出发前速读</h2>${executionNote ? p(executionNote) : ""}${p(`本文件含 ${dates.length} 天，可向下滚动或按日期跳转。`)}
${p(formatBudgetTarget(plan.requestSnapshot))}${p(`全程已知费用合计 ${formatMoneyRange(budget.totalMinCents, budget.totalMaxCents)}；另有 ${budget.unknownItemCount} 项金额待确认。${options.dates ? "此金额仍为全程口径，不是所选日期小计。" : ""}`)}
${list(budget.categories.filter((category) => category.itemCount).map((category) => `${costCategoryLabels[category.category]}：${formatMoneyRange(category.minTotalCents, category.maxTotalCents)}${category.unknownItemCount ? `，${category.unknownItemCount} 项待确认` : ""}`))}
</section>
<section id="redlines"><h2>关键时间红线</h2>${hardTimes.map((constraint) => `<article class="redline"><h3>${t(constraint.label)}</h3>${p(`${constraint.date} ${constraint.time} · 用户明确时间，须严格遵守；请提前完成接驳与安检。`)}</article>`).join("")}${redlines.map(renderRedline).join("")}</section>
${dates.map((d) => `<section id="day-${d}" class="day"><h2>第 ${allEvents.find((e) => e.date === d)!.dayNumber} 天 <span>${t(d)}</span></h2>${dayRoute(d)}${visuals.includeMap === false ? "" : renderGeographicMap(snapshot, options, d)}${projectExportWeather(snapshot, [d]).map((line) => p(line, "weather")).join("")}<ol class="timeline">${selected.filter((e) => e.date === d).map(renderEvent).join("")}</ol><a class="back" href="#top">回到日期导航 ↑</a></section>`).join("")}
<section id="preparation"><h2>行前核对与准备清单</h2>${preparation.length ? `<ul>${preparation.map((entry) => `<li>${t(`${entry.checkbox ? entry.completed ? "☑ 已确认" : "☐ 待准备" : "提醒"} · ${entry.group} · ${entry.title}${entry.date ? `（${entry.date}）` : ""}${entry.note.length ? `：${entry.note.join("；")}` : ""}${entry.changeNote ? `；${entry.changeNote}` : ""}`)}</li>`).join("")}</ul>` : p("所选日期没有行前核对事项。")}${p("勾选仅代表导出时的人工确认记录；天气、班次、预约与营业情况请以官方渠道和本人票面复核。", "muted")}</section>
</main><footer>${p("开放、预约、价格与交通请出发前以官方渠道和本人票面复核。")}${p("文件不会跟随旅行更新；需要新资料时请回到应用重新生成。", "muted")}<a class="back" href="#top">回到顶部 ↑</a></footer></body></html>`;
}

const MOBILE_CSS = `
*{box-sizing:border-box}
html{scroll-padding-top:190px}
body{margin:0;background:#f7f5ed;color:#2c342f;font:17px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}
header,main,footer{max-width:760px;margin:auto;padding:24px 18px}
header{padding:30px 22px 26px;color:#f7f4e9;background:#14231C;border-bottom:4px solid #D89B62}
h1{font-family:Georgia,"Times New Roman",serif;font-size:31px;line-height:1.28;margin:10px 0 16px}
h2{font-family:Georgia,"Times New Roman",serif;font-size:23px;line-height:1.45;margin:0 0 16px}
h2 span{display:block;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;color:#626b65;font-weight:500;margin-top:5px}
h3{font-size:20px;line-height:1.5;margin:8px 0}
p{margin:8px 0}
ul{padding-left:23px}
li{margin:10px 0}
#preparation ul{list-style:none;padding-left:0}
#preparation li{margin:8px 0;padding:12px 14px;border:1px solid #e0e4d8;border-radius:10px;background:#fffef9}
a{color:#355d46}
a:focus-visible,summary:focus-visible{outline:3px solid #a96442;outline-offset:3px}
.eyebrow{margin:0;font-size:12px;font-weight:700;letter-spacing:.16em;color:#DDBA87}
.cover-meta{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 14px}
.cover-meta>span{padding:5px 10px;border:1px solid rgb(255 255 255 / 18%);border-radius:999px;background:rgb(255 255 255 / 8%);font-size:13px;line-height:1.5}
.deadline-pill{display:inline-flex;align-items:center;margin:0 12px 8px 0;padding:7px 12px;border-radius:999px;background:#FDF3EB;color:#8A3F1E;font-size:14px;font-weight:750}
.cover-note,.muted{color:#626b65;font-size:14px}
header .muted{color:#D9E0D4}
.cover-note{margin:4px 0 12px;color:#D9E0D4}
.notice,.warning{border-radius:12px;padding:13px 15px;background:#e9eee3}
.warning{background:#f6e5d8;color:#773f29}
nav{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:6px;max-width:760px;margin:auto;padding:10px 14px;background:#f7f5ed;border-bottom:1px solid #d6dccc}
nav a{display:inline-flex;align-items:center;min-height:44px;padding:6px 12px;border:1px solid #bdcabb;border-radius:24px;text-decoration:none;font-size:14px;font-weight:600}
nav a:hover{background:#e4ecdf}
section{margin:0 0 34px;scroll-margin-top:10px}
.day-route{margin:0 0 14px;padding:13px 15px;border:1px solid #d9dfcf;border-radius:12px;background:#fffdf6}
.day-route>p{margin:0;color:#7b6d51;font-size:12px;letter-spacing:.1em}
.day-route>div{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:8px;font-size:15px;font-weight:650;color:#2f4237}
.day-route>div>span:not(.route-arrow){display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#f2f5ec;border:1px solid #d6ddcd;font-size:10.5px;color:#283c32}
.route-arrow{color:#B97A4F;font-size:14px}
.map{margin:14px 0}
.map svg{display:block;width:100%;height:auto}
.map-legend,.credit{font-size:12px}
.weather{padding:10px 12px;border-radius:10px;background:#e8eef0;font-size:14px}
.redline{padding:18px;border:1px solid #d8ab8f;border-left:5px solid #9d5639;border-radius:14px;background:#fffaf3;margin:14px 0}
.deadline{font-size:23px;font-weight:750;color:#8a4328;font-variant-numeric:tabular-nums}
.timeline{list-style:none;margin:0;padding:0}
.event{background:#fffef9;border:1px solid #e0e4d8;border-radius:16px;margin:14px 0;padding:19px}
.event-head{display:flex;align-items:center;gap:12px}
.number{border-radius:9px;background:#e5ecdf;color:#355b42;padding:3px 10px;font-size:14px;font-weight:700;flex-shrink:0}
.time{font-weight:750;color:#355b42;font-size:18px;font-variant-numeric:tabular-nums}
.location{font-weight:600}
.cost-line{color:#55685b;font-size:14px}
.next{padding-top:12px;border-top:1px dashed #d6ddcd;color:#425a47}
.record{color:#365b43;background:#edf2e7;border-radius:8px;padding:5px 9px}
summary{cursor:pointer;min-height:44px;padding:8px 0;color:#425a47;font-size:15px}
.back{display:inline-flex;min-height:44px;align-items:center;font-size:15px}
footer{border-top:1px solid #d6dccc;font-size:15px;padding-bottom:40px}
@media(min-width:768px){header,main,footer{padding-left:30px;padding-right:30px}.event{padding:24px}}
@media print{nav{position:static}.event,.redline{break-inside:avoid}body{background:white}}
`;
