import { exportPrivacy } from "./export-privacy";
import { calculateBudgetSummary, formatMoneyRange } from "./budget";
import { checklistGroups } from "./checklist";
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

export function renderMobileHtml(snapshot: ExportSnapshot, rawOptions: MobileExportOptions): string {
  const options = mobileExportOptionsSchema.parse(rawOptions), { plan } = snapshot;
  const allEvents = sortPlanEvents(plan.events), allDates = [...new Set(allEvents.map((e) => e.date))];
  const dates = options.dates === null ? allDates : allDates.filter((d) => options.dates!.includes(d));
  if (!dates.length || options.dates?.some((d) => !allDates.includes(d))) throw new ExportError("所选日期不属于这份已保存计划，请重新读取后选择。");
  const { text: t, privateIds } = exportPrivacy(snapshot, options);
  const p = (s: string, cls = "") => `<p${cls ? ` class="${cls}"` : ""}>${t(s)}</p>`;
  const list = (items: string[]) => items.length ? `<ul>${items.map((i) => `<li>${t(i)}</li>`).join("")}</ul>` : "";
  const selected = allEvents.filter((e) => dates.includes(e.date));
  const eventTime = (e: PlanEvent) => `${e.startTime}–${formatPlanDate(planEventEnd(e)) !== e.date ? `${formatPlanDate(planEventEnd(e))} ` : ""}${e.endTime}`;
  const publicLabel = !options.includePrivateAddress && options.publicLandmark ? `附近公共地标：${options.publicLandmark}。该地标仅供辨认，未按它重新计算接驳或红线。` : "";
  const privateNotice = options.includePrivateAddress ? "本文件包含私人地址，请妥善保存。" : "私人起终点已隐藏；红线仍按原起点计算，出发前请核对自己的位置。";
  const progress = snapshot.execution;
  const current = allEvents.find((e) => e.id === progress.currentEventId);
  const done = new Set(progress.items.filter((i) => i.completedAt).map((i) => i.eventId));
  const executionNote = progress.endedAt ? "截至导出，已手动记录全部完成。" : progress.startedAt ?
    `截至导出，已手动记录完成 ${allEvents.filter((e) => done.has(e.id)).length} / ${allEvents.length} 项；当时当前步骤：${current?.title ?? "待选择"}。` : "截至导出，尚未开始旅行；下列为计划顺序。";
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
    return `<li class="event"><div class="event-head"><span class="number">${e.dayNumber}.${index + 1}</span><p class="time">${t(eventTime(e))}</p></div>
      <h3>${t(e.title)}</h3>${p(location, "location")}
      ${p(`${e.status === "confirmed" ? "用户已确认安排" : "建议安排，待确认"}${e.locked ? " · 已锁定" : ""}`, "muted")}
      ${record?.completedAt ? p(`已手动完成 · ${formatRedlineTime(record.completedAt)}`, "record") : record?.arrivedAt ? p(`已手动到达 · ${formatRedlineTime(record.arrivedAt)}`, "record") : ""}
      ${e.note ? p(e.note) : ""}${routes}${ticketDetails}
      ${!incoming.length && !tickets.length ? p(e.type === "local_transport" ? "交通耗时按计划预留，具体路线与班次待核实。" : "到达方式：按前序安排衔接，未附已核验路线。", "muted") : ""}
      ${accommodation ? p(`住宿 ${accommodation.checkIn} 至 ${accommodation.checkOut}，${accommodation.roomCount} 间 / ${accommodation.nightCount} 晚；入住 ${accommodation.checkInFrom ?? "待确认"}，退房 ${accommodation.checkOutBy ?? "待确认"}；寄存${accommodation.luggageStorage === "available" ? "用户记录可用" : accommodation.luggageStorage === "unavailable" ? "不可用" : "待确认"}。${accommodation.conditionNote}`) : ""}
      ${facts.length ? `<details><summary>来源与待核对资料（${facts.length}）</summary>${list(facts.map((f) => `${evidenceFieldLabels[f.field]} · ${evidenceStatusLabels[f.status]}：${f.value}。${f.source}；获取 ${formatRedlineTime(f.retrievedAt)}；适用 ${formatRedlineTime(f.applicableFrom)} 至 ${formatRedlineTime(f.applicableUntil)}。`))}</details>` : p("开放、预约与价格未附适用核验资料，请出发前确认。", "muted")}
      <p class="next">${t(next ? `下一步：${next.date === e.date ? "" : `${next.date} `}${next.startTime} ${next.title}${dates.includes(next.date) ? "" : "（该日未选入本文件）"}` : "下一步：本次行程结束，核对返家安排。")}</p></li>`;
  };
  const checklist = snapshot.checklist.items.filter((i) => !i.deleted && !i.orphaned && (options.dates === null || !i.date || dates.includes(i.date) || i.date < allDates[0] || i.eventIds.some((id) => selected.some((e) => e.id === id))));
  const title = `${plan.requestSnapshot.destination ?? "旅行"} · 随身一页`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(MOBILE_HTML_CSP)}"><meta name="referrer" content="no-referrer"><title>${t(title)}</title>
<style>${MOBILE_CSS}</style></head><body><header id="top"><p class="eyebrow">SERENDIPITY / 随身行动资料</p><h1>${t(title)}</h1>
${p(`${formatRequestDateRange(plan.requestSnapshot)} · ${formatTravelerCount(plan.requestSnapshot)}`)}
${p(`计划 V${plan.versionNumber} · 需求修订 R${plan.requestRevision} · 清单修订 ${snapshot.checklist.revision} · 执行修订 ${progress.revision}`, "muted")}
${p(`生成于 ${formatRedlineTime(snapshot.generatedAt)}（北京时间） · 文件 ${snapshot.id.slice(0, 8)}`, "muted")}
${p("离线静态快照 · 不会自动更新，不提供实时天气、倒计时或在线导航。", "notice")}
${!snapshot.requirementUpToDate ? p("计划待更新：最新需求尚未应用。本文件日期、人数和预算仍使用这份计划自己的需求依据。", "warning") : ""}
${p(privateNotice)}${publicLabel ? p(publicLabel) : ""}${p(options.includeSeats ? "已选择带出座位。" : "座位已隐藏。", "muted")}
</header><nav aria-label="日期导航">${dates.map((d) => `<a href="#day-${d}">${t(`${d.slice(5)} · 第${allEvents.find((e) => e.date === d)!.dayNumber}天`)}</a>`).join("")}<a href="#redlines">红线</a><a href="#checklist">清单</a></nav>
<main><section aria-label="出发前速读"><h2>出发前速读</h2>${p(executionNote)}${p(`本文件含 ${dates.length} 天，可向下滚动或按日期跳转。`)}
${p(formatBudgetTarget(plan.requestSnapshot))}${p(`全程已知费用合计 ${formatMoneyRange(budget.totalMinCents, budget.totalMaxCents)}；另有 ${budget.unknownItemCount} 项金额待确认。${options.dates ? "此金额仍为全程口径，不是所选日期小计。" : ""}`)}
${p(`其中 ${budget.estimatedItemCount} 项估算、${budget.pendingItemCount} 项待确认、${budget.refundPendingItemCount} 项退款待处理。`, "muted")}</section>
<section id="redlines"><h2>关键时间红线</h2>${redlines.length ? redlines.map(renderRedline).join("") : p("所选日期没有可计算的有效票据红线。请核对票面、出发接驳与截止时刻，不能据此认定时间充裕。")}</section>
${dates.map((d) => `<section id="day-${d}" class="day"><h2>第 ${allEvents.find((e) => e.date === d)!.dayNumber} 天 <span>${t(d)}</span></h2><ol class="timeline">${selected.filter((e) => e.date === d).map(renderEvent).join("")}</ol><a class="back" href="#top">回到日期导航 ↑</a></section>`).join("")}
<section id="pending"><h2>待确认事项</h2>${list(plan.pendingItems.map((i) => `${i.title}：${i.reason}${i.requiredBefore ? `（${i.requiredBefore} 前）` : ""}`))}${list([...plan.validationResults.errors, ...plan.validationResults.warnings])}${p("天气、班次、预约与营业情况可能变化；这里保留导出时的提示，出发前请到官方渠道复核。", "muted")}</section>
<section id="checklist"><h2>出发前清单</h2>${p("勾选是导出时的人工确认记录，本文件不保存新的勾选。", "muted")}${checklist.length ? list(checklist.map((i) => `${i.completed ? "☑ 已确认" : "☐ 待准备"} · ${checklistGroups[i.group]} · ${i.title}${i.date ? `（${i.date}）` : ""}${i.note ? `：${i.note}` : ""}${i.changeNote ? `；${i.changeNote}` : ""}；${i.sourceLabel}`)) : p("所选日期没有清单事项。")}</section>
</main><footer>${p("保存为 .html 文件后可离线阅读。Windows Edge 本地打开已验证；手机文件应用的 HTML 支持有差异，Android / iOS 真机打开方式尚待验证。")}${p("文件不会跟随旅行更新；需要新资料时请回到应用重新生成。", "muted")}<a class="back" href="#top">回到顶部 ↑</a></footer></body></html>`;
}

const MOBILE_CSS = `
*{box-sizing:border-box}html{scroll-padding-top:190px}body{margin:0;background:#f7f5ed;color:#2c342f;font:17px/1.7 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:anywhere}header,main,footer{max-width:760px;margin:auto;padding:24px 18px}header{padding-top:38px}h1{font-size:30px;line-height:1.3;margin:12px 0}h2{font-size:23px;line-height:1.45;margin:0 0 18px}h2 span{display:block;font-size:16px;color:#626b65;font-weight:500}h3{font-size:20px;line-height:1.5;margin:8px 0}p{margin:8px 0}ul{padding-left:23px}li{margin:10px 0}a{color:#355d46}a:focus-visible,summary:focus-visible{outline:3px solid #a96442;outline-offset:3px}.eyebrow{font-size:13px;font-weight:700;letter-spacing:.14em;color:#49624e}.muted{color:#626b65;font-size:15px}.notice,.warning{border-radius:12px;padding:13px 15px;background:#e9eee3}.warning{background:#f6e5d8;color:#773f29}nav{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:6px;max-width:760px;margin:auto;padding:10px 14px;background:#f7f5ed;border-bottom:1px solid #d6dccc}nav a{display:inline-flex;align-items:center;min-height:44px;padding:6px 12px;border:1px solid #bdcabb;border-radius:24px;text-decoration:none;font-size:15px;font-weight:600}nav a:hover{background:#e4ecdf}section{margin:0 0 32px;scroll-margin-top:10px}.redline{padding:18px;border:1px solid #d8ab8f;border-left:5px solid #9d5639;border-radius:14px;background:#fffaf3;margin:14px 0}.deadline{font-size:23px;font-weight:750;color:#8a4328;font-variant-numeric:tabular-nums}.timeline{list-style:none;margin:0;padding:0}.event{background:#fffef9;border:1px solid #e0e4d8;border-radius:18px;margin:14px 0;padding:19px}.event-head{display:flex;align-items:center;gap:12px}.number{border-radius:9px;background:#e5ecdf;color:#355b42;padding:3px 10px;font-size:14px;font-weight:700;flex-shrink:0}.time{font-weight:750;color:#355b42;font-size:18px;font-variant-numeric:tabular-nums}.location{font-weight:600}.next{padding-top:12px;border-top:1px dashed #d6ddcd;color:#425a47}.record{color:#365b43;background:#edf2e7;border-radius:8px;padding:5px 9px}summary{cursor:pointer;min-height:44px;padding:8px 0;color:#425a47;font-size:15px}.back{display:inline-flex;min-height:44px;align-items:center;font-size:15px}footer{border-top:1px solid #d6dccc;font-size:15px;padding-bottom:40px}@media(min-width:768px){header,main,footer{padding-left:30px;padding-right:30px}.event{padding:24px}}@media print{nav{position:static}.event,.redline{break-inside:avoid}body{background:white}}
`;
