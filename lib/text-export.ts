import { getTripHardTimeConstraints } from "./trip-hard-constraints";
import { calculateBudgetSummary, costCategoryLabels, formatMoneyRange, formatMoneyValue } from "./budget";
import { checklistGroups } from "./checklist";
import { evidenceFieldLabels, evidenceStatusLabels } from "./evidence";
import { exportPrivacy } from "./export-privacy";
import { EMPTY_EXPORT_ADVISORIES, EXPORT_ADVISORY_NOTICE, projectExportAdvisories, projectExportWeather } from "./export-advisories";
import { ExportError, mobileExportOptionsSchema, type ExportSnapshot, type MobileExportOptions, type TextExportFormat } from "./export-snapshot";
import { formatPlanDate, planEventEnd, sortPlanEvents } from "./plan";
import { formatBudgetTarget, formatRequestDateRange, formatTravelerCount } from "./plan-overview";
import { formatRedlineTime } from "./redlines";
import { routeModeLabels } from "./routes";
import { isActiveTicket } from "./tickets";

const minutes = (seconds: number | null) => seconds === null ? "耗时待确认" : `约 ${Math.ceil(seconds / 60)} 分钟`;
const mode = (value: string | null) => value === "walking" ? "步行" : value === "driving" ? "驾车 / 打车" : value === "public_transit" ? "公共交通" : "方式待确认";
// Escape user/source Markdown, including raw HTML. Only the formatter supplies
// structural markup, so pasted notes cannot become images, links or headings.
const markdownText = (value: string) => value.replace(/([\\`*_{}[\]<>()#+.!|~&-])/g, "\\$1");

/** Pure, deterministic snapshot projection: no IO, model calls or live clock. */
export function renderTextExport(snapshot: ExportSnapshot, rawOptions: MobileExportOptions, format: TextExportFormat): string {
  const options = mobileExportOptionsSchema.parse(rawOptions), { plan } = snapshot;
  const events = sortPlanEvents(plan.events), allDates = [...new Set(events.map((e) => e.date))];
  const dates = options.dates === null ? allDates : allDates.filter((d) => options.dates!.includes(d));
  if (!dates.length || options.dates?.some((d) => !allDates.includes(d))) throw new ExportError("所选日期不属于这份已保存计划，请重新读取后选择。");
  const selected = events.filter((e) => dates.includes(e.date)), selectedIds = new Set(selected.map((e) => e.id));
  const { clean, privateIds } = exportPrivacy(snapshot, options);
  const text = (value: string) => {
    // Strip embedded controls so source notes cannot alter document structure.
    // eslint-disable-next-line no-control-regex
    const safe = clean(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, " ");
    return format === "markdown" ? markdownText(safe) : safe;
  };
  const lines: string[] = [];
  const separate = () => { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); };
  const paragraph = (value: string) => { separate(); lines.push(text(value), ""); };
  const heading = (value: string, level = 2) => { separate(); lines.push(format === "markdown" ? `${"#".repeat(level)} ${text(value)}` : `【${text(value)}】`, ""); };
  const item = (value: string) => { lines.push(`- ${text(value)}`); };
  heading(`${plan.requestSnapshot.destination ?? "旅行"} · 随身行程`, 1);
  paragraph(`${formatRequestDateRange(plan.requestSnapshot)} · ${formatTravelerCount(plan.requestSnapshot)}`);
  paragraph(`计划 V${plan.versionNumber} · 需求修订 R${plan.requestRevision} · 清单修订 ${snapshot.checklist.revision} · 执行修订 ${snapshot.execution.revision}`);
  paragraph(`生成于 ${formatRedlineTime(snapshot.generatedAt)}（北京时间） · 文件 ${snapshot.id.slice(0, 8)} · 所有时刻均为北京时间`);
  paragraph(`导出日期：${dates.join("、")}。静态快照，不会自动更新；天气、班次与营业情况请出发前复核。`);
  if (!snapshot.requirementUpToDate) paragraph("计划待更新：最新需求尚未应用。本文件日期、人数和预算仍使用这份计划自己的需求依据。");
  paragraph(options.includePrivateAddress ? "本文件包含私人地址，请妥善保存。" : "私人起终点已隐藏；红线仍按原起点计算，出发前请核对自己的位置。");
  if (!options.includePrivateAddress && options.publicLandmark) paragraph(`附近公共地标：${options.publicLandmark}。仅供辨认，未按它重新计算接驳或红线。`);
  paragraph(options.includeSeats ? "已选择带出座位。" : "座位已隐藏。");

  heading("预算摘要（全程）");
  const budget = calculateBudgetSummary(plan.costs, plan.requestSnapshot);
  paragraph(formatBudgetTarget(plan.requestSnapshot));
  paragraph(`全程已知费用合计 ${formatMoneyRange(budget.totalMinCents, budget.totalMaxCents)}；另有 ${budget.unknownItemCount} 项金额待确认，未知不等于零。${options.dates ? "此金额仍为全程口径，不是所选日期小计。" : ""}`);
  if (budget.perPersonMinCents !== null && budget.perPersonMaxCents !== null) paragraph(`已知费用人均 ${formatMoneyRange(budget.perPersonMinCents, budget.perPersonMaxCents)}。`);
  for (const category of budget.categories.filter((c) => c.itemCount)) item(`${costCategoryLabels[category.category]}：已知 ${formatMoneyRange(category.minTotalCents, category.maxTotalCents)}；${category.unknownItemCount} 项金额待确认。`);
  lines.push("");
  paragraph(`其中 ${budget.estimatedItemCount} 项估算、${budget.pendingItemCount} 项待确认、${budget.confirmedItemCount} 项已确认；已支付已知金额 ${formatMoneyValue(budget.paidMinCents)} 元，${budget.refundPendingItemCount} 项退款待处理。取消活动不代表退款。`);
  if (budget.overspendStatus === "confirmed") paragraph("预算提醒：已知费用已超过预算目标。");
  else if (budget.overspendStatus === "possible") paragraph("预算提醒：费用区间可能超过预算目标。");

  heading("关键时间红线");
  for (const constraint of getTripHardTimeConstraints(plan.requestSnapshot).filter((value) => dates.includes(value.date))) paragraph(`硬时间红线：${constraint.date} ${constraint.label}；须严格遵守。`);
  const redlines = snapshot.redlines.filter((r) => selectedIds.has(r.input.eventId) || r.suggestedAt && dates.includes(formatPlanDate(new Date(r.suggestedAt))));
  if (!redlines.length) paragraph("所选日期没有可计算的有效票据红线。请核对票面、出发接驳与截止时刻，不能据此认定时间充裕。");
  for (const r of redlines) {
    const date = events.find((e) => e.id === r.input.eventId)?.date, route = r.suggestedCheck?.route ?? r.input.route;
    heading(`${r.input.direction === "departure" ? "去程出门红线" : "返程出发红线"} · ${formatRedlineTime(r.suggestedAt, date)}`, 3);
    paragraph(`前往 ${r.input.destination}；${r.precision === "verified" ? "导出时资料已核验" : r.precision === "estimated" ? "估算，出发前复核" : "待确认，不保证可行"}。${r.reason}`);
    paragraph(`原起点：${r.input.origin}；接驳 ${minutes(route.durationSeconds)}；办理 ${minutes(r.input.steps.reduce((sum, s) => sum + s.seconds, 0))}；额外缓冲 ${minutes(r.bufferSeconds)}。`);
    for (const deadline of r.input.deadlines) item(`${deadline.label}：${formatRedlineTime(deadline.at, date)} · ${deadline.source}`);
    for (const note of [...r.conflicts, ...r.input.blockers, ...r.input.assumptions]) item(note);
    paragraph(`路线依据：${!options.includePrivateAddress && r.input.direction === "departure" ? "原起点接驳参考，私人路线细节已省略" : route.source}；${route.kind === "timed" ? "班次与路况依赖时刻，离线不能重新查询。" : "固定耗时参考。"}`);
  }

  const progress = snapshot.execution;
  heading("执行记录");
  paragraph(progress.endedAt ? "截至导出，已手动记录全部完成。" : progress.startedAt ? `截至导出，已手动完成 ${events.filter((e) => progress.items.some((i) => i.eventId === e.id && i.completedAt)).length} / ${events.length} 项；当时当前步骤：${events.find((e) => e.id === progress.currentEventId)?.title ?? "待选择"}。` : "截至导出，尚未开始旅行；下列为计划顺序。");
  for (const date of dates) {
    heading(`第 ${events.find((e) => e.date === date)!.dayNumber} 天 · ${date}`);
    selected.filter((e) => e.date === date).forEach((event, index) => {
      const endDate = formatPlanDate(planEventEnd(event));
      heading(`${event.dayNumber}.${index + 1} ${event.startTime}–${endDate !== date ? `${endDate} ` : ""}${event.endTime} ${event.title}`, 3);
      paragraph(`地点：${!options.includePrivateAddress && privateIds.has(event.id) ? "私人地点已隐藏" : event.locationName || "地点待确认"}。${event.status === "confirmed" ? "用户已确认安排" : "建议安排，待确认"}${event.locked ? " · 已锁定" : ""}`);
      if (event.note) paragraph(event.note);
      const record = progress.items.find((i) => i.eventId === event.id);
      if (record?.arrivedAt) item(`已手动到达：${formatRedlineTime(record.arrivedAt)}`);
      if (record?.completedAt) item(`已手动完成：${formatRedlineTime(record.completedAt)}`);
      const routes = plan.routeLegs.filter((r) => r.toEventId === event.id), tickets = plan.tickets.filter((t) => t.eventId === event.id && isActiveTicket(t));
      for (const r of routes) {
        const origin = events.find((e) => e.id === r.fromEventId), hidden = !options.includePrivateAddress && (privateIds.has(event.id) || !!origin && privateIds.has(origin.id));
        item(`到这里：${hidden ? "私人路线起终点已隐藏" : `${origin?.locationName ?? "起点待确认"} → ${event.locationName ?? "地点待确认"}`}；${routeModeLabels[r.mode]}，${minutes(r.durationSeconds)}。`);
        item(`路线${r.status === "verified" ? "导出时已核验" : "待复核 / 估算"}；参考出发 ${r.date} ${r.departureTime}；${hidden ? "私人路线说明已省略，耗时保留原参考" : r.scheduleBasis}`);
        if (!hidden) for (const step of r.steps) item(step.instruction);
        item(`来源：${hidden ? "原计划接驳资料" : r.source} · 获取 ${formatRedlineTime(r.retrievedAt)}`);
      }
      for (const t of tickets) {
        item(`${t.mode === "train" ? "高铁 / 火车" : "航班"} ${t.serviceNumber ?? "班次待补"} · ${t.fromName ?? "出发站待补"} → ${t.toName ?? "到达站待补"} · 用户已确认票面`);
        item(`发车 / 起飞 ${t.date ?? "日期待补"} ${t.departureTime ?? "时刻待补"}；到达 ${t.arrivalDate ?? "日期待补"} ${t.arrivalTime ?? "时刻待补"}`);
        item(`出发接驳：${t.chainOriginName ?? "起点待补"} → ${t.fromName ?? "车站 / 机场"}；${mode(t.accessMode)}，${minutes(t.accessDurationMinutes === null ? null : t.accessDurationMinutes * 60)}，人工参考待核实。`);
        item(`到达接驳：${t.toName ?? "车站 / 机场"} → ${t.chainDestinationName ?? "终点待补"}；${mode(t.egressMode)}，${minutes(t.egressDurationMinutes === null ? null : t.egressDurationMinutes * 60)}，人工参考待核实。`);
        if (t.baggageNote) item(`行李：${t.baggageNote}`);
        if (options.includeSeats && t.seat) item(`座位：${t.seat}`);
      }
      if (!routes.length && !tickets.length) item("到达方式：按前序安排衔接，具体路线、班次与耗时待核实。");
      const stay = event.accommodationSelection;
      if (stay) item(`住宿 ${stay.checkIn} 至 ${stay.checkOut}，${stay.roomCount} 间 / ${stay.nightCount} 晚；入住 ${stay.checkInFrom ?? "待确认"}，退房 ${stay.checkOutBy ?? "待确认"}；寄存${stay.luggageStorage === "available" ? "用户记录可用" : stay.luggageStorage === "unavailable" ? "不可用" : "待确认"}。${stay.conditionNote}`);
      const facts = snapshot.evidence.filter((f) => f.eventId === event.id);
      for (const f of facts) item(`来源与核验：${evidenceFieldLabels[f.field]} · ${evidenceStatusLabels[f.status]}：${f.value}。${f.source}；获取 ${formatRedlineTime(f.retrievedAt)}；适用 ${formatRedlineTime(f.applicableFrom)} 至 ${formatRedlineTime(f.applicableUntil)}。`);
      if (!facts.length) item("开放、预约与价格未附适用核验资料，请出发前确认。");
      const next = events[events.findIndex((e) => e.id === event.id) + 1];
      paragraph(next ? `下一步：${next.date === date ? "" : `${next.date} `}${next.startTime} ${next.title}${dates.includes(next.date) ? "" : "（该日未选入本文件）"}` : "下一步：本次行程结束，核对返家安排。");
    });
  }
  heading("待确认事项");
  for (const pending of plan.pendingItems) item(`${pending.title}：${pending.reason}${pending.requiredBefore ? `（${pending.requiredBefore} 前）` : ""}`);
  for (const note of [...plan.validationResults.errors, ...plan.validationResults.warnings]) item(note);
  paragraph("天气、班次、预约与营业情况可能变化；本文件保留导出时提示，出发前请到官方渠道复核。");
  heading("已获取天气预报");
  for (const line of projectExportWeather(snapshot, dates)) paragraph(line);
  heading("旅行提醒与注意事项");
  paragraph(EXPORT_ADVISORY_NOTICE);
  const advisories = projectExportAdvisories(snapshot, dates);
  for (const advisory of advisories) {
    heading(advisory.title, 3);
    for (const line of advisory.paragraphs) paragraph(line);
  }
  if (!advisories.length) paragraph(EMPTY_EXPORT_ADVISORIES);
  heading("出发前清单");
  paragraph("勾选是导出时的人工确认记录；文字中的改动不会同步回应用。");
  const checklist = snapshot.checklist.items.filter((i) => !i.deleted && !i.orphaned && (options.dates === null || !i.date || dates.includes(i.date) || i.date < allDates[0] || i.eventIds.some((id) => selectedIds.has(id))));
  for (const i of checklist) {
    const label = `${i.completed ? "已确认" : "待准备"} · ${checklistGroups[i.group]} · ${i.title}${i.date ? `（${i.date}）` : ""}${i.note ? `：${i.note}` : ""}${i.changeNote ? `；${i.changeNote}` : ""}；${i.sourceLabel}`;
    lines.push(format === "markdown" ? `- [${i.completed ? "x" : " "}] ${text(label)}` : `- ${text(label)}`);
  }
  if (!checklist.length) paragraph("所选日期没有清单事项。");
  lines.push("");
  paragraph("来源说明：保留资料名称、获取时间、适用日期及核验状态；在线链接、定位坐标、原始票图和证件信息不随文字导出。静态文件不保证实时可行，请以最新官方信息与本人票面为准。");
  return `${lines.join("\n").trimEnd()}\n`;
}
