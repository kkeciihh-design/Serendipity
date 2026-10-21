import { renderLongImageHtml } from "./long-image-html";
import { exportPrivacy } from "./export-privacy";
import { sortPlanEvents } from "./plan";
import { calculateBudgetSummary, costCategoryOrder, costCategoryLabels, costItemLineTotals, formatMoneyRange } from "./budget";
import { evidenceFieldLabels, evidenceStatusLabels } from "./evidence";
import { formatRedlineTime } from "./redlines";
import { type ExportSnapshot, type MobileExportOptions } from "./export-snapshot";
import type { PdfContentOptions } from "./pdf";

export async function renderPdfHtml(snapshot: ExportSnapshot, options: MobileExportOptions, content: PdfContentOptions) {
  const { plan } = snapshot, { text: t } = exportPrivacy(snapshot, options);
  const events = sortPlanEvents(plan.events), dates = [...new Set(events.map((e) => e.date))].filter((d) => !options.dates || options.dates.includes(d));
  const selected = events.filter((e) => dates.includes(e.date));
  const label = (id: string) => { const e = events.find((v) => v.id === id); return e ? `${e.dayNumber}.${events.filter((v) => v.date === e.date).findIndex((v) => v.id === id) + 1}` : "已移除项目"; };
  const p = (s: string) => `<p>${t(s)}</p>`;
  const title = content.mode === "complete" ? "完整旅行手册" : "简化旅行资料（无地图）";
  // Notes copied into a checklist/reminder remain fully readable beside the
  // event. Use an explicit printed reference instead of repeating them twice.
  const referenceRepeatedNote = (note: string | null | undefined, eventId: string | null | undefined) => {
    const event = events.find((item) => item.id === eventId);
    return note && event?.note === note ? `详细说明见每日时间轴 ${label(event.id)}。` : note;
  };
  const printSnapshot: ExportSnapshot = { ...snapshot,
    checklist: { ...snapshot.checklist, items: snapshot.checklist.items.map((item) => ({ ...item, note: referenceRepeatedNote(item.note, item.eventId) ?? item.note })) },
    ...(snapshot.advisories ? { advisories: { ...snapshot.advisories, items: snapshot.advisories.items.map((item) => ({ ...item, reason: referenceRepeatedNote(item.reason, item.eventId) ?? item.reason })) } } : {}),
  };
  // Reuse the same text/privacy projection and only locally licensed images.
  let html = await renderLongImageHtml(printSnapshot, options, { includeMap: content.mode === "complete", includePhotos: content.includePhotos });
  // Print once what the timeline already expresses through its order. Repeated
  // generic caveats and “next” links otherwise take more space than the route.
  html = html.replace(/<p class="next">[\s\S]*?<\/p>/g, (paragraph) => paragraph.includes("本次行程结束") ? paragraph : "")
    .replace(/<p class="muted">(?:到达方式：按前序安排衔接，未附已核验路线。|开放、预约与价格未附适用核验资料，请出发前确认。)<\/p>/g, "");
  const recommendations = ([ ["activity", "景点推荐与已选安排"], ["meal", "餐厅推荐与已选安排"], ["accommodation", "住宿区域与入住安排"] ] as const).map(([type, heading]) => {
    const items = selected.filter((e) => e.type === type && (e.accommodationSelection || e.attractionSelection || e.restaurantSelection));
    if (!items.length) return "";
    return `<section class="chapter"><h2>${heading}</h2>${p("已保存的用户选择摘要；具体时间与说明见每日时间轴。")}${items.length ? items.map((e) => {
      const stay = e.accommodationSelection, choice = e.attractionSelection ?? e.restaurantSelection;
      return `<article class="recommendation"><h3>${t(`${label(e.id)} · ${e.locationName || e.title}`)}</h3>${p(stay ? `${stay.areaName} · ${stay.kind === "area" ? "住宿区域参考，非已订酒店" : "用户记录酒店，预订情况请核对"}。${stay.checkIn} 至 ${stay.checkOut}，${stay.roomCount} 间 / ${stay.nightCount} 晚；入住 ${stay.checkInFrom ?? "待确认"}，退房 ${stay.checkOutBy ?? "待确认"}，寄存 ${stay.luggageStorage === "available" ? "用户记录可用" : stay.luggageStorage === "unavailable" ? "不可用" : "待确认"}。${stay.conditionNote}` : choice ? "用户已从推荐入口选择，开放、预约、价格请以适用来源及本人确认结果为准。" : "尚未保存具体推荐选择，当前为计划安排。")}${p(`详情与交通见每日时间轴 ${label(e.id)}。`)}</article>`;
    }).join("") : p("所选安排已列在每日时间轴；出发前核对开放、预约与价格。")}</section>`;
  }).join("");
  const budget = calculateBudgetSummary(plan.costs, plan.requestSnapshot);
  // Compact the overview without changing the mobile document's budget list.
  html = html.replace(/(<section aria-label="出发前速读">[\s\S]*?)<ul>[\s\S]*?<\/ul>/, (_, overview: string) =>
    `${overview}<div class="budget-category-strip">${budget.categories.map((category) => p(`${costCategoryLabels[category.category]}：${formatMoneyRange(category.minTotalCents, category.maxTotalCents)}${category.unknownItemCount ? `，${category.unknownItemCount} 项待确认` : ""}`)).join("")}</div>`);
  const eventOrder = new Map(events.map((event, index) => [event.id, index]));
  const orderedCosts = [...plan.costs].sort((left, right) =>
    (eventOrder.get(left.linkedEventId) ?? Number.MAX_SAFE_INTEGER) -
    (eventOrder.get(right.linkedEventId) ?? Number.MAX_SAFE_INTEGER) ||
    costCategoryOrder.indexOf(left.category) - costCategoryOrder.indexOf(right.category) ||
    left.id.localeCompare(right.id));
  const costDescription = (c: (typeof plan.costs)[number]) => {
    const certainty = c.certainty === "estimated" ? "估算" : c.certainty === "user_confirmed" ? "已确认" : "待确认";
    if (c.category === "accommodation") return `${costCategoryLabels[c.category]} · ${(c.nightCount ?? budget.factors.nightCount)}晚${certainty}`;
    if (c.unit === "per_person") return `${costCategoryLabels[c.category]} · ${(c.dinerCount ?? budget.factors.travelerCount)}人${certainty}`;
    if (c.unit === "per_ticket") return `${costCategoryLabels[c.category]} · ${(c.quantity ?? 1)}张${certainty}`;
    return `${costCategoryLabels[c.category]} · ${certainty}`;
  };
  const budgetHtml = `<section class="chapter"><h2>全程预算与费用明细</h2>${p(`全程已知费用合计 ${formatMoneyRange(budget.totalMinCents, budget.totalMaxCents)}；另有 ${budget.unknownItemCount} 项金额待确认。${options.dates ? "即使仅选部分日期，以下仍为全程口径。" : ""}`)}${p(`已支付已知下限 ${formatMoneyRange(budget.paidMinCents, budget.paidMinCents)}；退款待处理 ${budget.refundPendingItemCount} 项。未知金额不按零计算，取消活动不代表退款。`)}<div class="budget-category-strip">${budget.categories.map((c) => p(`${costCategoryLabels[c.category]}：${formatMoneyRange(c.minTotalCents, c.maxTotalCents)}；${c.unknownItemCount} 项金额待确认。`)).join("")}</div><div class="cost-grid">${orderedCosts.map((c) => {
    const total = costItemLineTotals(c, budget.factors), event = events.find((e) => e.id === c.linkedEventId);
    return `<article class="cost"><p><strong>${t(`${label(c.linkedEventId)} · ${event?.title ?? costCategoryLabels[c.category]}`)}</strong><span class="cost-amount">${t(formatMoneyRange(total.minCents, total.maxCents))}</span></p>${p(costDescription(c))}</article>`;
  }).join("")}</div></section>`;
  const sources = `<section class="chapter"><h2>资料来源与适用范围</h2>${p("编号与每日时间轴一致；来源状态仅对应导出时的资料。地图署名与照片许可附在对应图下。未列出的开放、价格、预约信息仍待确认。")}${snapshot.evidence.filter((f) => selected.some((e) => e.id === f.eventId)).map((f, i) => p(`来源 ${i + 1} · ${label(f.eventId)} · ${evidenceFieldLabels[f.field]}：${f.source}；${evidenceStatusLabels[f.status]}，获取 ${formatRedlineTime(f.retrievedAt)}。详细内容见对应时间轴。`)).join("")}${p("票面、座位、住宿条件、清单与完成状态来自用户记录；交通路线的来源及获取时间见相应时间轴，时间红线为程序按保存条件计算，估算不等于承诺。")}${p("地图数据：OpenStreetMap contributors / ODbL 1.0，https://www.openstreetmap.org/copyright；图形为保存坐标的位置示意，无道路底图，不用于导航。中文字体 Noto Sans SC / SIL Open Font License 1.1。")}</section>`;
  html = html
    .replace('<p class="eyebrow">', `<p class="document-kind">${title}</p><p class="eyebrow">`)
    .replaceAll("出发前速读", "旅行总览")
    .replace("请按图片编号顺序阅读", "按页码阅读每日地图、时间轴及后续章节");
  html = html.replace('<section id="preparation">', `${recommendations}${budgetHtml}<section id="preparation" class="chapter">`).replace("</main>", `${sources}</main>`);
  html = html.replace('</header>', `<div class="contents"><h2>随身目录</h2>${p("旅行总览 / 时间红线 / 每日地图与时间轴（景点推荐、餐厅推荐、住宿区域） / 全程预算 / 行前核对与准备清单 / 来源")}</div></header>`);
  return html.replace("</style>", `${PDF_CSS}</style>`).replace("<body>", `<body data-pdf-mode="${content.mode}">`);
}

const PDF_CSS = `
.day-route>div>span:not(.route-arrow){display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:#f2f5ec;border:1px solid #d6ddcd;font-size:10.5px;color:#283c32}
#preparation li{list-style:none;display:block}
@page{size:A4 portrait;margin:12mm 14mm}html{scroll-padding:0}body{width:182mm;background:white;font:12px/1.5 "Noto Sans SC",sans-serif;color:#283c32}header,main,footer{padding:0;margin:0;max-width:none}header{padding:14px 18px 12px;background:#f4f7f0;border-top:4px solid #45634d;color:#283c32}h1,h2,h3{font-family:Georgia,"Times New Roman","Noto Serif SC",serif}h1{font-size:26px;line-height:1.25;margin:7px 0 9px}h2{font-size:18px;margin:0 0 8px}h2 span{display:inline;font-family:"Noto Sans SC",sans-serif;font-size:11px;margin-left:8px}h3{font-size:13px;margin:4px 0}.document-kind{display:inline-block;margin:0;padding:3px 8px;border-radius:999px;background:#45634d;color:#fffaf0;font-family:"Noto Sans SC",sans-serif;font-size:10px}.eyebrow{margin:0;color:#7b816d;font-size:9px}.cover-meta{gap:4px;margin-bottom:7px}.cover-meta>span{padding:2px 7px;border-color:#c7d1c0;background:#fff;font-size:10px;color:#3f4f42}.deadline-pill{margin:0 6px 5px 0;padding:3px 8px;font-size:11px}.cover-note,header .muted{color:#5f6f60;font-size:10px}.time{font-size:13px}.muted,.credit{font-size:10px}.deadline{font-size:18px}.day-route{margin:0 0 7px;padding:6px 8px;border-color:#d6ddcd;background:#fffdf5}.day-route>p{font-size:9px;letter-spacing:.08em}.day-route>div{gap:4px;margin-top:3px;font-size:11px}.route-arrow{font-size:10px}.event,.redline,.recommendation,.cost,.advisory,.source{border-radius:5px;border:1px solid #dbe1d7;padding:8px 10px;margin:0 0 7px;background:#fcfcf8}.budget-category-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 12px;margin:6px 0 8px;padding:6px 8px;border-radius:5px;background:#f4f7f0;border:1px solid #dbe1d7}.budget-category-strip p{font-size:10px;margin:0}.cost-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px 14px;align-items:stretch}.cost-grid>div{display:flex;flex-direction:column;min-width:0}.cost-grid .cost{flex:1;break-inside:avoid;margin:0 0 5px;padding:5px 7px}.cost-grid .cost-amount{float:none;display:block;margin:1px 0}.advisory{padding:6px 8px;margin-bottom:5px;line-height:1.35}.advisory h3{font-size:11px;margin:2px 0}.advisory p{font-size:10px;margin:2px 0}#preparation{font-size:11px;line-height:1.4}#preparation ul{list-style:none;padding-left:0}#preparation li{margin:3px 0;padding:5px 8px;border-bottom:1px solid #dbe1d7;background:#fcfcf8;border-radius:3px;break-inside:avoid}.cost{padding:5px 8px;margin-bottom:4px}.cost p{font-size:10px;margin:2px 0}.cost-amount{float:right;font-weight:bold;color:#355b42;margin-left:10px}.redline{border-left:4px solid #9d5639;background:#fffaf3}.event p,p{margin:3px 0}.number{font-size:10px}.notice,.warning{padding:5px 8px}.next{padding-top:4px}.contents{margin-top:9px;padding-top:7px;border-top:1px solid #b9c6b2}.contents h2{font-size:13px;margin:0}figure{margin:0 0 7px}figure img{max-height:150px}svg{height:150px!important;max-height:150px;width:100%}.map{margin:0 0 8px;padding:7px 8px;border:1px solid #dbe1d7;border-radius:5px;background:#f6f8f2}.map h3{margin-top:0}.map-legend,.map .credit{font-size:8px;line-height:1.35}.weather{font-size:10px;padding:5px 7px}li{margin:3px 0}details summary{padding:3px 0;min-height:0;font-size:10px}section{margin:0}.pdf-page{width:182mm;height:272mm;position:relative;break-after:page;padding:22px 0 24px}.pdf-page:last-child{break-after:auto}.pdf-content{height:100%;display:flow-root}.pdf-header,.pdf-footer{position:absolute;left:0;right:0;font-size:9px;color:#5b7061}.pdf-header{top:0;border-bottom:1px solid #d6ddcd;padding-bottom:4px}.pdf-footer{bottom:0;border-top:1px solid #d6ddcd;padding-top:4px;display:flex;justify-content:space-between}.continuation{font-size:10px;color:#67776d}.pdf-content>section{margin-bottom:7px}.pdf-content>*{max-width:100%}p,li{orphans:3;widows:3}footer{border:0;padding:3px 0;font-size:10px;line-height:1.4}footer p{margin:2px 0}ul{padding-left:18px}.event-head p{margin:0}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;
