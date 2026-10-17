import { renderLongImageHtml, renderGeographicMap } from "./long-image-html";
import { exportPrivacy } from "./export-privacy";
import { sortPlanEvents } from "./plan";
import { calculateBudgetSummary, costCategoryLabels, costCertaintyLabels, costPaymentLabels, costItemLineTotals, costItemQuantityDescription, costUnitLabels, formatMoneyRange } from "./budget";
import { evidenceFieldLabels, evidenceStatusLabels } from "./evidence";
import { formatRedlineTime } from "./redlines";
import { ExportError, type ExportSnapshot, type MobileExportOptions } from "./export-snapshot";
import type { PdfContentOptions } from "./pdf";

export async function renderPdfHtml(snapshot: ExportSnapshot, options: MobileExportOptions, content: PdfContentOptions) {
  const { plan } = snapshot, { text: t, privateIds } = exportPrivacy(snapshot, options);
  const events = sortPlanEvents(plan.events), dates = [...new Set(events.map((e) => e.date))].filter((d) => !options.dates || options.dates.includes(d));
  const selected = events.filter((e) => dates.includes(e.date));
  const label = (id: string) => { const e = events.find((v) => v.id === id); return e ? `${e.dayNumber}.${events.filter((v) => v.date === e.date).findIndex((v) => v.id === id) + 1}` : "已移除项目"; };
  const p = (s: string) => `<p>${t(s)}</p>`;
  const title = content.mode === "complete" ? "完整旅行手册" : "简化旅行资料（无地图）";
  // Reuse the same text/privacy projection and only locally licensed images.
  let html = await renderLongImageHtml(snapshot, options, { includeMap: false, includePhotos: content.includePhotos });
  for (const date of dates) {
    let maps = p("本次主动选择简化资料，不含每日地图。");
    if (content.mode === "complete") {
      const publicEvents = events.filter((e) => e.date === date && e.placeId && !privateIds.has(e.id));
      for (const e of publicEvents) {
        const place = plan.places.find((v) => v.id === e.placeId);
        if (!place || place.confirmation !== "user_confirmed" || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude) || Math.abs(place.latitude) > 90 || Math.abs(place.longitude) > 180) throw new ExportError(`${date} 地图地点或坐标不可用，请核对已确认地点后重试。`);
      }
      if (!publicEvents.length) throw new ExportError(`${date} 缺少已确认公开地点，无法生成完整手册的每日地图。请先确认地点，或主动选择简化资料。`);
      const cities = [...new Set(publicEvents.map((e) => plan.places.find((v) => v.id === e.placeId)!.city))];
      maps = cities.length > 1 ? renderGeographicMap(snapshot, options, date, undefined, true).replace("当日位置示意图 · 北 ↑", "跨城位置总览 · 北 ↑") : "";
      maps += cities.map((city) => renderGeographicMap(snapshot, options, date, city, true).replace("当日位置示意图 · 北 ↑", `${t(city)} · 当地位置详图 · 北 ↑`)).join("");
      const missing = events.filter((e) => e.date === date && !privateIds.has(e.id) && !e.placeId);
      maps += p(missing.length ? `尚未定位：${missing.map((e) => `${label(e.id)} ${e.locationName ?? e.title}`).join("；")}。这些项目保留时间轴，不使用推测坐标。` : "当日已确认公开地点均已绘制。");
    }
    html = html.replace(`<div class="visuals"><p class=muted>本次未选择位置示意图。</p>`, `<div class="visuals">${maps}`);
  }
  const recommendations = ([ ["activity", "景点推荐与已选安排"], ["meal", "餐厅推荐与已选安排"], ["accommodation", "住宿区域与入住安排"] ] as const).map(([type, heading]) => {
    const items = selected.filter((e) => e.type === type);
    return `<section class="chapter"><h2>${heading}</h2>${p("以下仅整理已保存行程；建议、用户选择与已预订状态分别保留，不新增推荐或预订事实。")}${items.length ? items.map((e) => {
      const stay = e.accommodationSelection, choice = e.attractionSelection ?? e.restaurantSelection;
      return `<article class="recommendation"><h3>${t(`${label(e.id)} · ${e.locationName || e.title}`)}</h3>${p(`${e.date} ${e.startTime} · ${e.status === "confirmed" ? "用户已确认安排" : "建议安排，待确认"}`)}${p(stay ? `${stay.areaName} · ${stay.kind === "area" ? "住宿区域参考，非已订酒店" : "用户记录酒店，预订情况请核对"}。${stay.checkIn} 至 ${stay.checkOut}，${stay.roomCount} 间 / ${stay.nightCount} 晚；入住 ${stay.checkInFrom ?? "待确认"}，退房 ${stay.checkOutBy ?? "待确认"}，寄存 ${stay.luggageStorage === "available" ? "用户记录可用" : stay.luggageStorage === "unavailable" ? "不可用" : "待确认"}。${stay.conditionNote}` : choice ? "用户已从推荐入口选择，开放、预约、价格请以适用来源及本人确认结果为准。" : "尚未保存具体推荐选择，当前为计划安排。")}${e.note ? p(e.note) : ""}${p(`行程详情与交通衔接见每日时间轴 ${label(e.id)}。`)}</article>`;
    }).join("") : p("本次所选日期没有此类安排。")}</section>`;
  }).join("");
  const budget = calculateBudgetSummary(plan.costs, plan.requestSnapshot);
  const budgetHtml = `<section class="chapter"><h2>全程预算与费用明细</h2>${p(`全程已知费用合计 ${formatMoneyRange(budget.totalMinCents, budget.totalMaxCents)}；另有 ${budget.unknownItemCount} 项金额待确认。${options.dates ? "即使仅选部分日期，以下仍为全程口径。" : ""}`)}${p(`已支付已知下限 ${formatMoneyRange(budget.paidMinCents, budget.paidMinCents)}；退款待处理 ${budget.refundPendingItemCount} 项。未知金额不按零计算，取消活动不代表退款。`)}${budget.categories.filter((c) => c.itemCount).map((c) => p(`${costCategoryLabels[c.category]}：${formatMoneyRange(c.minTotalCents, c.maxTotalCents)}；${c.unknownItemCount} 项金额待确认。`)).join("")}${plan.costs.map((c) => {
    const total = costItemLineTotals(c, budget.factors), event = events.find((e) => e.id === c.linkedEventId);
    return `<article class="cost"><h3>${t(`${label(c.linkedEventId)} · ${event?.title ?? costCategoryLabels[c.category]}`)}</h3>${p(`${costCategoryLabels[c.category]} · 单价 ${formatMoneyRange(c.unitAmountCents, c.unitAmountMaxCents ?? c.unitAmountCents)} / ${costUnitLabels[c.unit]} × ${costItemQuantityDescription(c, budget.factors)}；合计 ${formatMoneyRange(total.minCents, total.maxCents)}`)}${p(`${costCertaintyLabels[c.certainty]} · ${costPaymentLabels[c.paymentStatus]}${c.eventRemoved ? " · 原活动已移除，费用保留" : ""}；${c.source === "user_confirmed" ? "用户确认资料" : "原计划费用草稿"}${c.note ? `；${c.note}` : ""}`)}</article>`;
  }).join("")}</section>`;
  const sources = `<section class="chapter"><h2>资料来源与适用范围</h2>${p("编号与每日时间轴一致；来源状态仅对应导出时的资料。地图署名与照片许可附在对应图下。未列出的开放、价格、预约信息仍待确认。")}${snapshot.evidence.filter((f) => selected.some((e) => e.id === f.eventId)).map((f, i) => `<article class="source"><h3>${t(`来源 ${i + 1} · ${label(f.eventId)} · ${evidenceFieldLabels[f.field]}`)}</h3>${p(`${evidenceStatusLabels[f.status]}：${f.value}`)}${p(`${f.source}；获取 ${formatRedlineTime(f.retrievedAt)}；适用 ${formatRedlineTime(f.applicableFrom)} 至 ${formatRedlineTime(f.applicableUntil)}`)}</article>`).join("")}${p("票面、座位、住宿条件、清单与完成状态来自用户记录；交通路线的来源及获取时间见相应时间轴，时间红线为程序按保存条件计算，估算不等于承诺。")}${p("地图数据：OpenStreetMap contributors / ODbL 1.0，https://www.openstreetmap.org/copyright；图形为保存坐标的位置示意，无道路底图，不用于导航。中文字体 Noto Sans SC / SIL Open Font License 1.1。")}</section>`;
  html = html.replaceAll("旅行长图", title).replaceAll("出发前速读", "旅行总览").replace("请按图片编号顺序阅读", "按页码阅读每日地图、时间轴及后续章节");
  html = html.replace('<section id="pending">', `${recommendations}${budgetHtml}<section id="pending" class="chapter">`).replace('<section id="checklist">', '<section id="checklist" class="chapter">').replace('<section id="advisories">', '<section id="advisories" class="chapter">').replace("</main>", `${sources}</main>`);
  html = html.replace('</header>', `<div class="contents"><h2>随身目录</h2>${p("旅行总览 / 时间红线 / 每日地图与时间轴 / 景点、餐厅与住宿 / 全程预算 / 待确认事项 / 出发前清单 / 提醒与来源")}</div></header>`);
  return html.replace("</style>", `${PDF_CSS}</style>`).replace("<body>", `<body data-pdf-mode="${content.mode}">`);
}

const PDF_CSS = `
@page{size:A4 portrait;margin:14mm}html{scroll-padding:0}body{width:182mm;background:white;font:12px/1.65 "Noto Sans SC",sans-serif;color:#283c32}header,main,footer{padding:0;margin:0;max-width:none}header{padding:38px 24px;background:#eef2e7;border-top:8px solid #45634d}h1{font-size:34px;margin:24px 0}h2{font-size:21px;margin:0 0 16px}h3{font-size:15px;margin:7px 0}.time{font-size:15px}.muted,.credit{font-size:10px}.deadline{font-size:22px}.event,.redline,.recommendation,.cost,.advisory,.source{border-radius:8px;border:1px solid #dbe1d7;padding:12px;margin:0 0 12px;background:#fcfcf8}.redline{border-left:4px solid #9d5639;background:#fffaf3}.event p{margin:5px 0}.number{font-size:12px}.notice,.warning{padding:10px}.next{padding-top:7px}.contents{margin-top:36px;padding-top:20px;border-top:1px solid #b9c6b2}figure{margin:0 0 14px}figure img{max-height:235px}svg{max-height:310px;width:100%}.map{margin:0 0 14px}.map ul{columns:1}li{margin:7px 0}details summary{padding:6px 0;min-height:0;font-size:12px}section{margin:0}.pdf-page{width:182mm;height:268mm;position:relative;break-after:page;padding:30px 0 28px}.pdf-page:last-child{break-after:auto}.pdf-content{height:100%;display:flow-root}.pdf-header,.pdf-footer{position:absolute;left:0;right:0;font-size:9px;color:#5b7061}.pdf-header{top:0;border-bottom:1px solid #d6ddcd;padding-bottom:7px}.pdf-footer{bottom:0;border-top:1px solid #d6ddcd;padding-top:7px;display:flex;justify-content:space-between}.continuation{font-size:10px;color:#67776d}.pdf-content>section{margin-bottom:12px}.pdf-content>*{max-width:100%}p,li{orphans:3;widows:3}footer{border:0;padding:10px 0}ul{padding-left:20px}.event-head p{margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;
