"use client";

import { ArrowUpRight, Bell, Check, ChevronDown, MapPin, Wallet } from "lucide-react";
import { useMemo } from "react";
import { calculateBudgetSummary, formatMoneyRange } from "@/lib/budget";
import { travelBudgetCategories } from "@/lib/budget-presentation";
import { numberPlanEvents } from "@/lib/map-link";
import { buildDailyRouteLinks, buildDailyRouteMarkers } from "@/lib/route-illustration";
import { cityRouteOriginIssue } from "@/lib/route-origin";
import { routeDayEvents } from "@/lib/route-day";
import type { PlanOverviewDay } from "@/lib/plan-overview";
import type { AdvisoryController } from "./advisory-panel";
import { MapCanvas } from "./map-canvas";
import type { PlanVersionClient } from "./plan-overview";
import styles from "./plan-workspace.module.css";

export function PlanCompanion({ plan, day, selectedEventId, highlightedEventId, onEventHover, advisories, onEventSelect, onMap, onBudget, onAdvisories }: {
  plan: PlanVersionClient;
  day: PlanOverviewDay;
  selectedEventId: string | null;
  highlightedEventId: string | null;
  onEventHover: (id: string | null) => void;
  advisories: AdvisoryController;
  onEventSelect: (id: string) => void;
  onMap: () => void;
  onBudget: () => void;
  onAdvisories: () => void;
}) {
  const events = useMemo(() => routeDayEvents(plan.events, day.date), [plan.events, day.date]);
  const markers = useMemo(() => buildDailyRouteMarkers(events, plan.places ?? [], plan.requestSnapshot.destination), [events, plan.places, plan.requestSnapshot.destination]);
  const routes = useMemo(() => buildDailyRouteLinks(events, markers, (plan.routeLegs ?? []).filter((route) =>
    !cityRouteOriginIssue(plan.events.find((event) => event.id === route.fromEventId)))), [plan, markers, events]);
  const budget = useMemo(() => calculateBudgetSummary(plan.costs, plan.requestSnapshot), [plan]);
  const active = advisories.view?.items.filter((item) => item.date === day.date && (!item.acknowledged || item.severity === "action")) ?? [];
  const categories = travelBudgetCategories(budget);
  const hasKnownCosts = categories.some((item) => item.knownItemCount > 0);
  const chartCategories = categories.filter((item) => item.maxTotalCents > 0);

  return <aside aria-label="当日伴随看板" className={styles.companion}>
    <section className={styles.companionCard} aria-labelledby="companion-map-title">
      <div className={styles.companionHeading}>
        <div><p className={styles.eyebrow}>THE DAILY ROUTE · {String(day.dayNumber).padStart(2, "0")}</p><h3 id="companion-map-title">今天，走过这些地方</h3></div>
        <button type="button" onClick={onMap} className={styles.iconAction} aria-label="打开完整地图"><ArrowUpRight size={19} /></button>
      </div>
      {markers.length ? <div className={styles.companionMap}><MapCanvas markers={markers} routes={routes} focusEventId={selectedEventId} highlightedEventId={highlightedEventId} onEventHover={onEventHover} onEventSelect={onEventSelect} compact title="当日路线地图预览" /></div> : <div className={styles.mapPlaceholder}>
        <MapPin size={27} strokeWidth={1.25} aria-hidden="true" /><p>当天尚未安排日程</p><span>添加安排后即可查看当日动线。</span>
      </div>}
      {markers.length ? <><ol className={styles.routeSequence} aria-label="当日动线站点">{numberPlanEvents(events).map(({ event, visitLabel }, index) => <li key={event.id}>{index > 0 ? <span className={styles.sequenceArrow} aria-hidden="true">→</span> : null}<button type="button" data-highlighted={highlightedEventId === event.id || selectedEventId === event.id} onMouseEnter={() => onEventHover(event.id)} onMouseLeave={() => onEventHover(null)} onFocus={() => onEventHover(event.id)} onBlur={() => onEventHover(null)} onClick={() => onEventSelect(event.id)}><span>{visitLabel}</span>{markers.find((marker) => marker.events.some((item) => item.id === event.id))?.name ?? event.title}</button></li>)}</ol><p className={styles.mapCaption}>按当日顺序绘制；建议位置与区域参考仅作动线示意，可打开完整地图核对入口。</p></> : null}
    </section>

    <section className={`${styles.companionCard} ${styles.budgetCard}`} aria-labelledby="companion-budget-title">
      <div className={styles.companionHeading}><h3 id="companion-budget-title"><Wallet size={16} aria-hidden="true" />全程预估总花费</h3><button type="button" onClick={onBudget} className={styles.textAction}>查看明细 <ArrowUpRight size={14} /></button></div>
      <p className={styles.budgetTotal} data-testid="companion-budget-total">{hasKnownCosts ? formatMoneyRange(budget.totalMinCents, budget.totalMaxCents) : "尚无报价"}</p>
      <p className={styles.budgetPerPerson} data-testid="companion-budget-per-person">人均 {hasKnownCosts ? formatMoneyRange(budget.perPersonMinCents, budget.perPersonMaxCents) : "—"}<span> · {budget.factors.travelerCount} 人同行</span></p>
      <p className={styles.budgetCaption}>交通、门票、餐饮与住宿参考费用{budget.unknownItemCount ? ` · ${budget.unknownItemCount} 项未报价费用未计入` : " · 以实际预订为准"}</p>
      {chartCategories.length ? <div className={styles.budgetBar} aria-hidden="true" data-testid="companion-budget-bar">{chartCategories.map((item) => <span key={item.category} data-category={item.category} style={{ flex: item.maxTotalCents }} />)}</div> : null}
      {hasKnownCosts ? <dl className={styles.budgetCategories}>{categories.map((item) => <div key={item.category}><dt><i data-category={item.category} />{item.label}</dt><dd>{!item.knownItemCount && item.unknownItemCount ? "—" : formatMoneyRange(item.minTotalCents, item.maxTotalCents)}</dd></div>)}</dl> : null}
    </section>

    <section className={`${styles.companionCard} ${styles.notesCard}`} aria-label="行程关键提醒">
      <div className={styles.companionHeading}><h3><Bell size={16} aria-hidden="true" />出发前，留意一下</h3><button type="button" onClick={onAdvisories} className={styles.textAction}>查看行程提醒 <ArrowUpRight size={14} /></button></div>
      {active.length ? <ul className={styles.conciseNotes}>{active.slice(0, 2).map((item) => <li key={item.id}><span className={styles.noteDot} /><button type="button" onClick={onAdvisories}>{item.targetName}：{item.title}</button></li>)}</ul> : null}
      {advisories.error ? <button type="button" className={styles.textAction} onClick={onAdvisories}>提醒暂未读到，点击重试</button> : null}
      {plan.pendingItems.length ? <>
        <ul className={styles.conciseNotes}>{plan.pendingItems.slice(0, 3).map((item) => <li key={item.id}><span className={styles.noteCircle} /><details className={styles.noteItem}><summary>{item.title}</summary><p>{item.reason}</p>{item.requiredBefore ? <span>建议在 {item.requiredBefore} 前确认</span> : null}</details></li>)}</ul>
        {plan.pendingItems.length > 3 ? <details className={styles.notesDetails}><summary>查看其余待确认事项（{plan.pendingItems.length - 3}）<ChevronDown size={14} aria-hidden="true" /></summary><ul>{plan.pendingItems.slice(3).map((item) => <li key={item.id}><strong>{item.title}</strong><p>{item.reason}</p>{item.requiredBefore ? <span>建议在 {item.requiredBefore} 前确认</span> : null}</li>)}</ul></details> : null}
      </> : !active.length ? <p className={styles.noNotes}><Check size={15} aria-hidden="true" />暂无待确认事项</p> : null}
      {plan.validationResults.warnings.length ? <details className={styles.notesDetails}><summary>行程校验提醒 · {plan.validationResults.warnings.length}<ChevronDown size={14} aria-hidden="true" /></summary><ul>{plan.validationResults.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
    </section>
    <p className={styles.companionFootnote}>留一点余地，给路上的不期而遇。</p>
  </aside>;
}
