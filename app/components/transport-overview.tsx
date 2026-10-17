"use client";
import { businessFetch } from "@/lib/business-fetch";

import { ArrowDown, ExternalLink, Plane, Plus, TrainFront } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PlanEvent } from "@/lib/plan";
import type { Ticket, TicketAction, TicketCore, TicketCostAllocation, TicketDirection, TicketMode } from "@/lib/tickets";
import { ticketChain, ticketWarnings } from "@/lib/tickets";
import { budgetFactorsFromSnapshot, costItemLineTotals, costPaymentLabels, hasProtectedCostFact } from "@/lib/budget";
import { ticketDuplicateHints } from "@/lib/ticket-import";
import type { PlanVersionClient } from "./plan-overview";
import { TicketImportPanel, type ImportReview } from "./ticket-import-panel";

const inputStyle = "mt-1 min-h-12 min-w-0 w-full rounded-md border border-sand bg-white px-3 py-2 text-base text-charcoal disabled:bg-shell disabled:text-graphite";
const actionStyle = "inline-flex min-h-12 items-center justify-center gap-2 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage disabled:cursor-not-allowed disabled:opacity-50";
const directions = ["departure", "return"] as const;
const directionLabels = { departure: "去程", return: "返程" };
const modeLabels = { train: "高铁 / 火车", flight: "国内飞机" };
const statusLabels = { draft: "草稿", active: "当前有效", cancelled: "已退票", replaced: "已替换" };
const accessLabels = { walking: "步行", public_transit: "公交 / 地铁", driving: "驾车 / 出租车" };
type TicketDraft = { [K in keyof TicketCore]-?: string };
type TicketOperation = { kind: "cancel" | "activate_draft" | "resolve_cost"; ticketId: string };

function existingTicketCost(plan: PlanVersionClient, eventId: string) {
  return plan.costs.find((cost) => cost.id === `cost-${eventId}` && cost.linkedEventId === eventId &&
    cost.category === "transport" && !cost.eventRemoved && hasProtectedCostFact(cost));
}

function selectedCostAllocation(plan: PlanVersionClient, eventId: string, choice: string): TicketCostAllocation {
  if (!existingTicketCost(plan, eventId) || choice === "separate") return { kind: "separate" };
  return choice === "pending" ? { kind: "pending" } : { kind: "existing", costId: choice };
}

function needsCostReview(plan: PlanVersionClient, ticket: Ticket) {
  return Boolean(ticket.confirmedAt && (ticket.costAllocation?.kind === "pending" ||
    !ticket.costAllocation && existingTicketCost(plan, ticket.eventId) && !plan.costs.some((cost) => cost.id === `ticket-${ticket.id}`)));
}

function TicketCostChoice({ plan, eventId, choice, onChange, disabled }: {
  plan: PlanVersionClient; eventId: string; choice: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const base = existingTicketCost(plan, eventId);
  if (!base) return <p className="mt-3 text-sm leading-6 text-graphite">这张票单独记录票面费用；付款与退款仍在预算中核对。</p>;
  const total = costItemLineTotals(base, budgetFactorsFromSnapshot(plan.requestSnapshot));
  return <fieldset className="mt-3 rounded-md border border-sand bg-shell p-3">
    <legend className="px-1 text-sm font-semibold">主票费用归属</legend>
    <p className="text-sm leading-6">本次主交通已有费用：{money(total.minCents)}{total.maxCents !== total.minCents ? `～${money(total.maxCents)}` : ""}，{costPaymentLabels[base.paymentStatus]}。多人合计可能已包含这张票，请按实际付款核对。</p>
    <label className="mt-2 block text-sm">这张票如何计费<select aria-label="这张票如何计费" className={inputStyle} value={choice} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="pending">暂不确定，保存票面后继续核对</option><option value={base.id}>已包含在上述既有费用中，不再加一笔</option><option value="separate">不在上述费用内，另记这张票的费用</option>
    </select></label>
    <p className="mt-2 text-xs leading-5 text-graphite">未决时费用保持待确认，不把票面金额重复计入。关联不会改写既有金额、付款或退款；多张同行票可共同关联同一笔总费用。</p>
  </fieldset>;
}

function blankTicket(event: PlanEvent, direction: TicketDirection, mode: TicketMode): TicketDraft {
  return {
    eventId: event.id, direction, mode, serviceNumber: "", seat: "", date: "", departureTime: "",
    arrivalDate: "", arrivalTime: "", fromName: "", fromDetail: "", toName: "", toDetail: "",
    chainOriginName: "", chainDestinationName: "", accessMode: "", accessDurationMinutes: "",
    accessFareCents: "", accessNote: "", egressMode: "", egressDurationMinutes: "",
    egressFareCents: "", egressNote: "", baggageNote: "", passengerCount: "1", fareCents: "",
    checkInCutoffMinutes: "", bagDropCutoffMinutes: "", boardingCutoffMinutes: "", bufferMinutes: "30", note: "",
  };
}

function ticketDraft(ticket: TicketCore, event: PlanEvent): TicketDraft {
  return Object.fromEntries(Object.keys(blankTicket(event, ticket.direction, ticket.mode)).map((key) => {
    const field = key as keyof TicketCore;
    const value = ticket[field];
    return [field, value == null ? "" : field.endsWith("Cents") ? String(Number(value) / 100) : String(value)];
  })) as TicketDraft;
}

function draftCore(draft: TicketDraft): TicketCore {
  const numbers = new Set(["passengerCount", "bufferMinutes", "accessDurationMinutes", "egressDurationMinutes", "checkInCutoffMinutes", "bagDropCutoffMinutes", "boardingCutoffMinutes"]);
  const core = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key,
    !value.trim() ? null : key.endsWith("Cents") ? Math.round(Number(value) * 100) : numbers.has(key) ? Number(value) : value.trim(),
  ])) as TicketCore;
  return core.mode === "train" ? { ...core, checkInCutoffMinutes: null, bagDropCutoffMinutes: null } : core;
}

function money(cents: number | null) {
  return cents === null || !Number.isFinite(cents) ? "待确认" : `¥${(cents / 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function dateTime(date: string | null, time: string | null) {
  return `${date ?? "日期待补"} ${time ?? "时刻待补"}`;
}

function localTime(value: string | null) {
  if (!value) return "待补资料后计算";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function ticketName(ticket: TicketCore) {
  return `${ticket.serviceNumber || "班次待补"} · ${ticket.fromName || "出发站待补"} → ${ticket.toName || "到达站待补"}`;
}

function TicketDetails({ ticket }: { ticket: TicketCore }) {
  return <dl className="grid min-w-0 gap-x-4 gap-y-2 text-sm leading-6 sm:grid-cols-2">
    <div><dt className="text-graphite">座位（仅本机票面）</dt><dd>{ticket.seat || "待补"}</dd></div>
    <div className="min-w-0 sm:col-span-2"><dt className="text-graphite">班次与站点</dt><dd className="break-words font-semibold">{modeLabels[ticket.mode]} · {ticketName(ticket)}</dd></div>
    <div><dt className="text-graphite">出发（北京时间）</dt><dd>{dateTime(ticket.date, ticket.departureTime)}{ticket.fromDetail ? ` · ${ticket.fromDetail}` : ""}</dd></div>
    <div><dt className="text-graphite">到达（北京时间）</dt><dd>{dateTime(ticket.arrivalDate, ticket.arrivalTime)}{ticket.toDetail ? ` · ${ticket.toDetail}` : ""}</dd></div>
    <div className="min-w-0"><dt className="text-graphite">门到门</dt><dd className="break-words">{ticket.chainOriginName || "起点待补"} → {ticket.chainDestinationName || "终点待补"}</dd></div>
    <div><dt className="text-graphite">票面金额</dt><dd>{money(ticket.fareCents)} / 人 × {ticket.passengerCount || "人数待补"} 人 · 合计 {money(ticket.fareCents === null || !ticket.passengerCount ? null : ticket.fareCents * ticket.passengerCount)}</dd></div>
    {ticket.note ? <div className="sm:col-span-2"><dt className="text-graphite">备注</dt><dd className="break-words">{ticket.note}</dd></div> : null}
  </dl>;
}

function JourneyChain({ ticket, events }: { ticket: Ticket; events: PlanEvent[] }) {
  const times = ticketChain(ticket);
  const warnings = ticketWarnings(ticket, events);
  const flight = ticket.mode === "flight";
  const access = (prefix: "access" | "egress") => {
    const mode = prefix === "access" ? ticket.accessMode : ticket.egressMode;
    const minutes = prefix === "access" ? ticket.accessDurationMinutes : ticket.egressDurationMinutes;
    const fare = prefix === "access" ? ticket.accessFareCents : ticket.egressFareCents;
    const note = prefix === "access" ? ticket.accessNote : ticket.egressNote;
    return `${mode ? accessLabels[mode] : "方式待补"} · ${minutes === null ? "耗时待补" : `${minutes} 分钟`} · ${money(fare)}${note ? ` · ${note}` : ""}`;
  };
  const steps = [
    { label: ticket.direction === "departure" ? "从出发点启程" : "离开住宿 / 活动点", title: ticket.chainOriginName || "门到门起点待补", detail: "建议出发时刻见上方时间红线，包含办理耗时与适用时刻复核。" },
    { label: "前往车站 / 机场", title: access("access"), detail: "人工记录的全段耗时需包含步行、候车与换乘。" },
    { label: flight ? "到机场办理" : "进站与安检", title: [ticket.fromName || "出发站点待补", ticket.fromDetail].filter(Boolean).join(" · "), detail: "到站、办理与到检票口时刻见红线详情，各个截止分别检查。" },
    { label: "城际主交通", title: `${ticket.serviceNumber || "班次待补"} · ${modeLabels[ticket.mode]}`, detail: `${dateTime(ticket.date, ticket.departureTime)} → ${dateTime(ticket.arrivalDate, ticket.arrivalTime)}` },
    { label: flight ? "落地、取行李与出机场" : "到站与出站", title: [ticket.toName || "到达站点待补", ticket.toDetail].filter(Boolean).join(" · "), detail: flight ? "取行李和出机场时间计入后段接驳，勿遗漏。" : "出站、步行与候车时间计入后段接驳。" },
    { label: ticket.direction === "return" ? "返家接驳" : "抵达后的接驳", title: access("egress"), detail: "公交 / 地铁需按实际到达日期与时刻核对末班。" },
    { label: ticket.direction === "return" ? "到达最终返回点" : "到达住宿 / 活动点", title: ticket.chainDestinationName || "门到门终点待补", detail: `估算抵达：${localTime(times.destinationArrivalAt)}` },
  ];
  return <div className="mt-4">
    <ol data-testid="transport-chain" aria-label={`${directionLabels[ticket.direction]}完整交通链`} className="space-y-2">
      {steps.map((step, index) => <li key={step.label} className="flex min-w-0 gap-3">
        <div className="flex w-7 shrink-0 flex-col items-center"><span className="flex size-7 items-center justify-center rounded-full bg-sage-soft text-xs font-semibold text-sage">{index + 1}</span>{index < steps.length - 1 ? <ArrowDown aria-hidden="true" className="mt-2 size-4 text-sage/60" /> : null}</div>
        <div className="min-w-0 flex-1 pb-3"><p className="text-xs text-graphite">{step.label}</p><p className="mt-1 break-words text-sm font-semibold leading-6 text-charcoal">{step.title}</p><p className="mt-1 text-xs leading-5 text-graphite">{step.detail}</p></div>
      </li>)}
    </ol>
    <div className="rounded-md bg-shell p-3 text-sm leading-6 text-graphite">
      <p>行李：{ticket.baggageNote || "待确认；请核对件数、尺寸与托运要求"}</p>
      <p>{flight ? `值机截止：${ticket.checkInCutoffMinutes === null ? "待确认" : `起飞前 ${ticket.checkInCutoffMinutes} 分钟`}；托运截止：${ticket.bagDropCutoffMinutes === null ? "待确认" : `起飞前 ${ticket.bagDropCutoffMinutes} 分钟`}；` : ""}检票 / 登机截止：{ticket.boardingCutoffMinutes === null ? "待确认" : `发车 / 起飞前 ${ticket.boardingCutoffMinutes} 分钟`}。</p>
      <p>额外安全余量 {ticket.bufferMinutes} 分钟，只计一次。办理截止按你录入的规定计算；当前链条为人工资料估算，接驳班次尚需核对。</p>
    </div>
    {warnings.length > 0 ? <div className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6 text-clay"><p className="font-semibold">资料待补 / 衔接提醒</p><ul className="mt-1 list-disc space-y-1 pl-5">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
  </div>;
}

function TicketFields({ draft, setDraft, disabled, activeTicket }: { draft: TicketDraft; setDraft: (draft: TicketDraft) => void; disabled: boolean; activeTicket?: Ticket }) {
  const protectedFields = new Set<keyof TicketCore>(["mode", "serviceNumber", "date", "departureTime", "arrivalDate", "arrivalTime", "fromName", "fromDetail", "toName", "toDetail", "passengerCount", "fareCents", "seat"]);
  const fieldDisabled = (key: keyof TicketCore) => disabled || Boolean(activeTicket && protectedFields.has(key) && activeTicket[key] != null && activeTicket[key] !== "");
  const field = (key: keyof TicketDraft, label: string, type = "text", options: { min?: number; max?: number; maxLength?: number; step?: number; placeholder?: string } = {}) => <label className="block min-w-0 text-sm font-medium text-charcoal">{label}<input type={type} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} disabled={fieldDisabled(key)} className={inputStyle} maxLength={120} {...options} /></label>;
  const accessFields = (prefix: "access" | "egress", label: string) => <fieldset className="min-w-0 rounded-md border border-sand p-3">
    <legend className="px-1 text-sm font-semibold">{label}</legend>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">{label}方式<select value={draft[`${prefix}Mode`]} disabled={disabled} onChange={(event) => setDraft({ ...draft, [`${prefix}Mode`]: event.target.value })} className={inputStyle}><option value="">待确认</option>{Object.entries(accessLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      {field(`${prefix}DurationMinutes`, `${label}总耗时（分钟）`, "number", { min: 1, max: 1440, step: 1 })}
      {field(`${prefix}FareCents`, `${label}全段费用（元）`, "number", { min: 0, max: 10000, step: 0.01 })}
      {field(`${prefix}Note`, `${label}说明 / 末班`, "text", { maxLength: 240, placeholder: "适用日期时刻、候车、末班或自驾费用" })}
    </div>
  </fieldset>;
  return <>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium text-charcoal">交通方式<select value={draft.mode} disabled={fieldDisabled("mode")} onChange={(event) => setDraft({ ...draft, mode: event.target.value })} className={inputStyle}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {field("serviceNumber", "车次 / 航班号", "text", { maxLength: 40 })}
      {field("seat", "座位 / 车厢", "text", { maxLength: 80 })}
      {field("date", "出发日期", "date")}{field("departureTime", "出发时刻", "time")}
      {field("arrivalDate", "到达日期", "date")}{field("arrivalTime", "到达时刻", "time")}
      {field("fromName", "出发站点 / 机场")}{field("toName", "到达站点 / 机场")}
      {field("fromDetail", "出发站 / 航站楼详情")}{field("toDetail", "到达站 / 航站楼详情")}
      {field("passengerCount", "票面人数", "number", { min: 1, max: 20, step: 1 })}
      {field("fareCents", "每人票价（元）", "number", { min: 0, max: 20000000, step: 0.01 })}
    </div>
    <p className="mt-2 text-xs leading-5 text-graphite">所有日期与时刻均为北京时间。只填写票面已知内容，缺少到达时间等资料可留空；同城不同站、跨日到达请逐项核对。票价按每人单价 × 人数计算，付款和退款请在预算中单独记录。</p>
    <details className="mt-4 rounded-md border border-sand bg-cream p-3" open>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-charcoal">门到门接驳（可稍后补充）</summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">{field("chainOriginName", "门到门起点", "text", { placeholder: "家门口 / 公共地标 / 住宿" })}{field("chainDestinationName", "门到门终点", "text", { placeholder: "住宿 / 活动地点 / 最终返回点" })}</div>
      <div className="mt-3 grid gap-3">{accessFields("access", "前段接驳")}{accessFields("egress", "后段接驳")}</div>
      <p className="mt-2 text-xs leading-5 text-graphite">总耗时包含步行、候车、换乘；后段还需包含出站或取行李。驾车费用未填时保持待确认，另核对路桥、燃油与停车。公交末班请按到达时刻核实。</p>
    </details>
    <details className="mt-3 rounded-md border border-sand bg-cream p-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-charcoal">行李、办理截止与安全余量</summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {field("baggageNote", "行李 / 托运要求", "text", { maxLength: 240 })}
        {field("bufferMinutes", "额外安全余量（分钟）", "number", { min: 0, max: 240, step: 1 })}
        {draft.mode === "flight" ? <>{field("checkInCutoffMinutes", "值机截止（起飞前分钟）", "number", { min: 0, max: 240, step: 1 })}{field("bagDropCutoffMinutes", "托运截止（起飞前分钟）", "number", { min: 0, max: 240, step: 1 })}</> : null}
        {field("boardingCutoffMinutes", draft.mode === "flight" ? "登机截止（起飞前分钟）" : "检票截止（发车前分钟）", "number", { min: 0, max: 240, step: 1 })}
        {field("note", "票面备注 / 规定来源", "text", { maxLength: 240 })}
      </div>
      <p className="mt-2 text-xs leading-5 text-graphite">截止分钟请据官方规定填写，没有依据时留空；无需托运可填写 0 并备注。初始安全余量 30 分钟为建议值，可调整；仅在办理截止之外增加一次。</p>
    </details>
  </>;
}

function DirectionSection({ tripId, plan, direction, hidden, onSaved }: { tripId: string; plan: PlanVersionClient; direction: TicketDirection; hidden: boolean; onSaved: (plan: PlanVersionClient) => void }) {
  const event = plan.events.find((item) => item.type === (direction === "departure" ? "departure_transport" : "return_transport"));
  const tickets = (plan.tickets ?? []).filter((ticket) => ticket.direction === direction);
  const active = tickets.filter((ticket) => ticket.status === "active" && ticket.confirmedAt);
  const [mode, setMode] = useState<TicketMode>("train");
  const [draft, setDraft] = useState<TicketDraft | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [editTicketId, setEditTicketId] = useState<string | null>(null);
  const [operation, setOperation] = useState<TicketOperation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [operationAcknowledged, setOperationAcknowledged] = useState(false);
  const [duplicateDecision, setDuplicateDecision] = useState<"" | "same" | "companion">("");
  const [costChoice, setCostChoice] = useState("pending");
  const [busy, setBusy] = useState(false);
  const [importReview, setImportReview] = useState<ImportReview | null>(null);
  const [importKey, setImportKey] = useState(0);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const editor = useRef<HTMLElement>(null);
  const operationPanel = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const previousPlan = useRef(plan.id);
  useEffect(() => {
    if (previousPlan.current !== plan.id) {
      setAcknowledged(false);
      setOperationAcknowledged(false);
      setDuplicateDecision("");
      setCostChoice("pending");
      previousPlan.current = plan.id;
    }
  }, [plan.id]);
  const target = tickets.find((ticket) => ticket.id === operation?.ticketId);
  const replaced = tickets.find((ticket) => ticket.id === replacementId);
  const edited = tickets.find((ticket) => ticket.id === editTicketId);
  const replacementValid = !replacementId || replaced?.status === "active";
  const editValid = !editTicketId || edited?.status === "draft" || edited?.status === "active";
  const operationValid = operation?.kind === "cancel" ? target?.status === "active" : operation?.kind === "resolve_cost" ? Boolean(target?.confirmedAt) : target?.status === "draft";
  const draftDuplicates = operation?.kind === "activate_draft" && target?.importSource
    ? ticketDuplicateHints(plan.tickets ?? [], target, target.importSource, target.id) : [];
  const skipDuplicate = draftDuplicates.length > 0 && duplicateDecision === "same";

  const save = async (action: TicketAction) => {
    if (!plan.isCurrent || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const response = await businessFetch(`/api/trips/${tripId}/plans/${plan.versionNumber}/tickets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const payload = await response.json().catch(() => null) as { error?: string; plan?: PlanVersionClient } | null;
      if (!response.ok || !payload?.plan) throw new Error(payload?.error ?? `保存失败（HTTP ${response.status}），请重试。`);
      onSaved(payload.plan);
      setImportKey((key) => key + 1);
      setImportReview(null);
      setAcknowledged(false);
      setOperationAcknowledged(false);
      const remainsDraft = action.action === "create_draft" || action.action === "update_details" && tickets.find((ticket) => ticket.id === action.ticketId)?.status === "draft";
      setFeedback({ error: false, message: `票据事实已保存至计划版本 ${payload.plan.versionNumber}。${remainsDraft ? "草稿尚未成为有效票。" : "请查看交通链中的资料待补与衔接提醒。"}` });
      return true;
    } catch (error) {
      setFeedback({ error: true, message: `${error instanceof Error ? error.message : "票面保存失败。"} 输入已保留；请核对页面状态后再试。` });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const openEditor = (replacement?: Ticket, editDetails = false) => {
    if (!event) return;
    setImportReview(null);
    setCostChoice("pending");
    if (replacement && editDetails) {
      if (editTicketId !== replacement.id || !draft) setDraft(ticketDraft(replacement, event));
      setEditTicketId(replacement.id);
      setReplacementId(null);
    } else if (replacement) {
      if (replacementId !== replacement.id || !draft) setDraft(ticketDraft(replacement, event));
      setReplacementId(replacement.id);
      setEditTicketId(null);
    } else if (replacementId || editTicketId || !draft || importReview) {
      setDraft(blankTicket(event, direction, mode));
      setReplacementId(null);
      setEditTicketId(null);
    }
    setAcknowledged(false);
    setEditorOpen(true);
    setOperation(null);
    requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const submit = async (formEvent: FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    if (!draft || !event || !replacementValid || !editValid) return;
    const button = (formEvent.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const core = { ...draftCore(draft), eventId: event.id, direction };
    const isDraft = button?.value === "draft";
    if (!isDraft && !acknowledged) return;
    const imported = importReview ? { importSource: importReview.source, importResolution: importReview.resolution } : {};
    const action: TicketAction = editTicketId ? { action: "update_details", ticketId: editTicketId, ticket: core, acknowledged: true } : isDraft ? { action: "create_draft", ticket: core, ...imported } : replacementId
      ? { action: "replace", ticketId: replacementId, replacement: core, costAllocation: selectedCostAllocation(plan, event.id, costChoice), acknowledged: true, ...imported }
      : { action: "activate", ticket: core, costAllocation: selectedCostAllocation(plan, event.id, costChoice), acknowledged: true, ...imported };
    if (await save(action)) {
      setDraft(null);
      setEditorOpen(false);
      setReplacementId(null);
      setEditTicketId(null);
    }
  };

  return <section hidden={hidden} aria-label={`${directionLabels[direction]}交通`} className="mt-4 min-w-0">
    {!event ? <p className="rounded-md bg-clay-soft p-4 text-sm leading-6 text-clay">这个计划缺少{directionLabels[direction]}交通事件，请先修复行程再录入票面。</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-base font-semibold text-charcoal">{directionLabels[direction]} · {active.length ? `${active.length} 张有效票` : "尚未确认有效票"}</h4><button type="button" disabled={!plan.isCurrent || busy} onClick={() => openEditor()} className={actionStyle}><Plus aria-hidden="true" className="size-4" />录入票面</button></div>
      {plan.isCurrent ? <TicketImportPanel key={importKey} tickets={tickets} disabled={busy} onDiscard={() => { if (importReview) { setEditorOpen(false); setDraft(null); setImportReview(null); } setOperation(null); setAcknowledged(false); setOperationAcknowledged(false); }} onRefund={(ticketId) => { setOperation({ kind: "cancel", ticketId }); setOperationAcknowledged(false); setEditorOpen(false); requestAnimationFrame(() => operationPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }} onReview={(review) => {
        const fields = Object.fromEntries(Object.entries(review.fields).map(([key, value]) => [key, value === null ? "" : key === "fareCents" ? String(Number(value) / 100) : String(value)]));
        setDraft({ ...blankTicket(event, direction, "train"), ...fields });
        setImportReview(review); setCostChoice("pending"); setReplacementId(review.resolution === "replacement" ? review.targetId ?? null : null); setEditTicketId(null); setOperation(null); setAcknowledged(false); setEditorOpen(true);
        requestAnimationFrame(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }} /> : null}
      {active.length === 0 ? <div className="mt-3 rounded-md border border-sand bg-cream p-4">
        <h5 className="text-sm font-semibold">先选候选，再核对实际票面</h5>
        <p className="mt-2 text-sm leading-6 text-graphite">建议时段：{event.date} {event.startTime} → {event.endDate ?? event.date} {event.endTime}，来自本版行程安排，班次、价格和余票待查询。</p>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="候选交通方式">{(["train", "flight"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)} className={`${actionStyle} ${mode === value ? "bg-sage-soft" : "bg-white"}`}>{value === "train" ? <TrainFront aria-hidden="true" className="size-4" /> : <Plane aria-hidden="true" className="size-4" />}{modeLabels[value]}</button>)}</div>
        <a href={mode === "train" ? "https://www.12306.cn/index/" : "https://www.umetrip.com/"} target="_blank" rel="noopener noreferrer" className={`${actionStyle} mt-3 bg-white`}><ExternalLink aria-hidden="true" className="size-4" />{mode === "train" ? "前往铁路 12306 查询" : "前往航旅纵横查询"}</a>
        <p className="mt-2 text-xs leading-5 text-graphite">官方入口不会自动带入条件；请核对完整站名 / 航站楼、日期与行李规定。购票与退改签均在官方平台完成。</p>
        <p className="mt-3 break-words text-sm leading-7 text-charcoal">{direction === "departure" ? "出发点" : "住宿 / 活动点"} → 前段接驳 → 进站 / 办理 → 城际交通 → 出站 / 取行李 → 后段接驳 → {direction === "departure" ? "住宿 / 活动点" : "最终返回点"}</p>
        <p className="mt-1 text-xs text-clay">全链地点、接驳与办理条件待补；此建议还不能作为可执行交通链。</p>
      </div> : null}
      {tickets.length > 0 ? <div className="mt-4 space-y-3" aria-label={`${directionLabels[direction]}票据列表`}>{tickets.map((ticket, index) => <article key={ticket.id} data-testid={`ticket-${ticket.id}`} aria-label={`${directionLabels[direction]}票据 ${index + 1} ${ticket.serviceNumber || "班次待补"} ${statusLabels[ticket.status]}`} className="min-w-0 rounded-md border border-sand bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h5 className="text-sm font-semibold">票据 {index + 1} · {ticket.serviceNumber || "班次待补"}</h5><span className={`rounded px-2 py-1 text-xs font-medium ${ticket.status === "active" ? "bg-sage-soft text-sage" : "bg-shell text-graphite"}`}>{statusLabels[ticket.status]}</span></div>
        <TicketDetails ticket={ticket} />
        {ticket.importSource ? <p className="mt-2 text-xs text-graphite">来源：本机 OCR，关键票面由用户确认；非官方核验。原图不保存。</p> : null}
        <p className="mt-2 break-all text-xs leading-5 text-graphite">票据编号：{ticket.id}{ticket.confirmedAt ? ` · 票面确认于 ${new Date(ticket.confirmedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : " · 尚未确认"}</p>
        {ticket.status === "active" && ticket.confirmedAt ? <JourneyChain ticket={ticket} events={plan.events} /> : null}
        {ticket.status === "draft" ? <p className="mt-2 text-sm leading-6 text-graphite">草稿不会固定日程，核对后才生效。</p> : null}
        {ticket.costAllocation?.kind === "existing" ? <p className="mt-2 text-sm leading-6 text-graphite">票费已明确包含在既有主交通费用中，不另加一笔；退款仍须在预算中确认。</p> : null}
        {needsCostReview(plan, ticket) ? <div className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6"><p>{ticket.costAllocation ? "主票费用归属待核对，金额暂未重复计入。" : "旧版票费归属待核对，原费用金额保持不变。"}</p>{plan.isCurrent ? <button type="button" className={`${actionStyle} mt-2`} disabled={busy} onClick={() => { setOperation({ kind: "resolve_cost", ticketId: ticket.id }); setCostChoice("pending"); setOperationAcknowledged(false); setEditorOpen(false); requestAnimationFrame(() => operationPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>核对票费归属</button> : null}</div> : null}
        {ticket.status === "cancelled" || ticket.status === "replaced" ? <p className="mt-2 break-words text-sm leading-6 text-graphite">历史票面，不再参与当前交通约束。{ticket.replacedByTicketId ? `替换为：${ticket.replacedByTicketId}。` : ""}原已支付费用保留，退款请在预算中确认记录。</p> : null}
        {plan.isCurrent && (ticket.status === "active" || ticket.status === "draft") ? <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => openEditor(ticket, true)} className={actionStyle}>{ticket.status === "draft" ? "编辑草稿" : "补充资料"}</button>
          <button type="button" disabled={busy} onClick={() => { setOperation({ kind: ticket.status === "draft" ? "activate_draft" : "cancel", ticketId: ticket.id }); setOperationAcknowledged(false); setDuplicateDecision(""); setCostChoice("pending"); setEditorOpen(false); requestAnimationFrame(() => operationPanel.current?.scrollIntoView({ behavior: "smooth", block: "center" })); }} className={actionStyle}>{ticket.status === "draft" ? "确认这张草稿" : "记录已退票"}</button>
          {ticket.status === "active" ? <button type="button" disabled={busy} onClick={() => openEditor(ticket)} className={actionStyle}>替换这张票</button> : null}
        </div> : null}
      </article>)}</div> : null}
      {operation && target ? <section ref={operationPanel} aria-label={operation.kind === "cancel" ? "退票事实确认" : operation.kind === "resolve_cost" ? "票费归属确认" : "草稿票面确认"} className="mt-4 rounded-md border border-sage bg-cream p-4">
        <h4 className="mb-3 text-base font-semibold">{operation.kind === "cancel" ? "核对指定退票" : operation.kind === "resolve_cost" ? "核对票费归属" : "核对草稿票面"}</h4>
        <TicketDetails ticket={target} />
        <p className="mt-2 break-all text-xs text-graphite">指定票据：{target.id}</p>
        <p className="mt-3 text-sm leading-6 text-graphite">{operation.kind === "cancel" ? "仅将这张票记为已退票，其他同行有效票继续保留。原付款不会自动清零；请在预算中记录已确认退款。" : operation.kind === "resolve_cost" ? "只核对这张票的费用归属，原票状态、其他同行票及已有付款退款保持不变。" : "确认后成为有效票。接驳或票面资料不足时会保存事实并显示待补提醒。"}</p>
        {draftDuplicates.length > 0 ? <div className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6"><p>当前计划已有疑似同票，请重新核对本次关系：{draftDuplicates.map((hint) => hint.reason).join("；")}。</p><label className="mt-2 block">草稿与已有票的关系<select aria-label="草稿与已有票的关系" value={duplicateDecision} className={inputStyle} disabled={busy} onChange={(event) => { setDuplicateDecision(event.target.value as typeof duplicateDecision); setOperationAcknowledged(false); }}><option value="">请选择</option><option value="same">同一张票，跳过生效</option><option value="companion">不同同行者的独立票</option></select></label></div> : null}
        {operation.kind !== "cancel" && !skipDuplicate ? <TicketCostChoice plan={plan} eventId={target.eventId} choice={costChoice} disabled={busy} onChange={(value) => { setCostChoice(value); setOperationAcknowledged(false); }} /> : null}
        {!operationValid ? <p className="mt-3 text-sm text-clay">该票状态已经变化，请关闭并重新选择。</p> : null}
        {!skipDuplicate ? <label className="mt-3 flex min-h-12 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={operationAcknowledged} disabled={!plan.isCurrent || busy || !operationValid} onChange={(event) => setOperationAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0" />{operation.kind === "cancel" ? "我已在官方平台办妥这张票的退票" : operation.kind === "resolve_cost" ? "我已核对这张票与所选费用的归属" : "我已核对这张草稿，确认是已购有效票"}</label> : null}
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!plan.isCurrent || busy || !operationValid || !skipDuplicate && (!operationAcknowledged || draftDuplicates.length > 0 && !duplicateDecision)} onClick={async () => {
          if (skipDuplicate) { setOperation(null); setOperationAcknowledged(false); setFeedback({ error: false, message: "已跳过同一张票。草稿保持未生效，票据与费用没有增加。" }); return; }
          const action: TicketAction = operation.kind === "cancel" ? { action: "cancel", ticketId: target.id, acknowledged: true }
            : operation.kind === "resolve_cost" ? { action: "resolve_cost", ticketId: target.id, costAllocation: selectedCostAllocation(plan, target.eventId, costChoice), acknowledged: true }
            : { action: "activate_draft", ticketId: target.id, costAllocation: selectedCostAllocation(plan, target.eventId, costChoice), importResolution: duplicateDecision === "companion" ? "companion" : "new", acknowledged: true };
          if (await save(action)) setOperation(null);
        }} className={`${actionStyle} bg-sage text-white hover:bg-focus`}>{busy ? "正在保存…" : skipDuplicate ? "跳过这张草稿" : operation.kind === "cancel" ? "确认记录退票" : operation.kind === "resolve_cost" ? "确认费用归属" : "确认草稿生效"}</button><button type="button" disabled={busy} onClick={() => { setOperation(null); setOperationAcknowledged(false); }} className={actionStyle}>取消操作</button></div>
      </section> : null}
      {editorOpen && draft ? <section ref={editor} aria-label="手工票面" className="mt-4 min-w-0 rounded-md border border-sage bg-white p-4">
        <h4 className="text-base font-semibold">{importReview ? `核对识别的${directionLabels[direction]}票面` : editTicketId ? edited?.status === "draft" ? "编辑草稿资料" : "补充有效票资料" : replacementId ? "替换指定票面" : `手工录入${directionLabels[direction]}票面`}</h4>
        <p className="mt-2 text-sm leading-6 text-graphite">{editTicketId && edited?.status === "active" ? "可补充空白票面字段、接驳与办理资料。已确认的非空票面字段已锁定；如已办理改签，请使用替换指定票入口。" : "已知票面如实记录，未知字段留空。确认有效票会固定已知班次与时刻，接驳资料可稍后补齐。"}</p>
        {editTicketId ? <p className="mt-2 break-all text-xs text-graphite">保留票据编号：{editTicketId}{edited?.status === "draft" ? " · 修改后仍为草稿，需另行确认生效。" : ""}</p> : null}
        {replacementId ? <div className="mt-4 rounded-md border border-sand bg-shell p-3" aria-label="指定原票预览"><h5 className="mb-2 text-sm font-semibold">指定原票 · 将记为已替换</h5>{replaced ? <TicketDetails ticket={replaced} /> : <p>原票已不存在。</p>}<p className="mt-2 break-all text-xs text-graphite">指定票据：{replacementId}</p></div> : null}
        <form onSubmit={submit} className="mt-4">
          <TicketFields draft={draft} setDraft={(next) => { setDraft(next); setAcknowledged(false); }} disabled={!plan.isCurrent || busy} activeTicket={editTicketId && edited?.status === "active" ? edited : undefined} />
          {!editTicketId ? <TicketCostChoice plan={plan} eventId={event.id} choice={costChoice} disabled={busy} onChange={(value) => { setCostChoice(value); setAcknowledged(false); }} /> : null}
          <details className="mt-4 rounded-md bg-sage-soft/50 p-3" open={Boolean(replacementId)}><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">{replacementId ? "新票预览 · 确认后生效" : "核对票面预览"}</summary><div className="mt-2" aria-label="新票预览"><TicketDetails ticket={draftCore(draft)} /></div></details>
          {replacementId ? <p className="mt-3 text-sm leading-6 text-graphite">只替换上述指定原票，其他同行票保持有效。旧已支付费用保留；新票票价与退款分别在预算中核对。</p> : null}
          {!replacementValid ? <p className="mt-3 text-sm text-clay">原票已不再有效，请关闭后重新选择要替换的票。</p> : null}
          {!editValid ? <p className="mt-3 text-sm text-clay">这张票的状态已经变化，请关闭后重新选择。</p> : null}
          <label className="mt-3 flex min-h-12 items-start gap-3 text-sm leading-6"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={!plan.isCurrent || busy || !replacementValid || !editValid} className="mt-1 size-5 shrink-0" />{editTicketId ? "我已核对并确认本次补充或修改的资料" : replacementId ? "我已办妥改签 / 换票，并核对指定原票和新票" : "我已核对票面，确认这是已购有效票"}</label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {!replacementId && !editTicketId ? <button type="submit" value="draft" disabled={!plan.isCurrent || busy} className={actionStyle}>保存草稿</button> : null}
            <button type="submit" value="active" disabled={!plan.isCurrent || busy || !acknowledged || !replacementValid || !editValid} className={`${actionStyle} bg-sage text-white hover:bg-focus`}>{busy ? "正在保存…" : editTicketId ? edited?.status === "draft" ? "保存草稿修改" : "保存补充资料" : replacementId ? "确认替换指定票" : "确认票面并保存"}</button>
            <button type="button" disabled={busy} onClick={() => { setEditorOpen(false); setAcknowledged(false); }} className={actionStyle}>收起并保留输入</button>
          </div>
        </form>
      </section> : null}
      {feedback ? <p role={feedback.error ? "alert" : "status"} className={`mt-4 rounded-md p-3 text-sm leading-6 ${feedback.error ? "bg-clay-soft text-clay" : "bg-sage-soft text-sage"}`}>{feedback.message}</p> : null}
    </>}
  </section>;
}

export function TransportOverview({ tripId, plan, onSaved, direction, onDirectionChange }: { tripId: string; plan: PlanVersionClient; onSaved: (plan: PlanVersionClient) => void; direction: TicketDirection; onDirectionChange: (direction: TicketDirection) => void }) {
  return <section className="mt-4 min-w-0" aria-label="门到门交通总览">
    <h3 className="text-lg font-semibold text-charcoal">把去程与返家都接完整</h3>
    <p className="mt-2 text-sm leading-6 text-graphite">核对家门口到目的地、目的地到最终返回点的每个环节。只有你确认的有效票参与当前交通约束。选择去程或返程后可导入对应票图。</p>
    {!plan.isCurrent ? <p className="mt-3 rounded-md bg-shell p-3 text-sm leading-6 text-graphite">历史版本只读，展示当时的票据与交通链。</p> : null}
    {!plan.requirementUpToDate && plan.isCurrent ? <p className="mt-3 rounded-md bg-clay-soft p-3 text-sm leading-6 text-clay">需求已变化，仍可记录真实票据或退改签事实；本计划继续保留待更新提示。</p> : null}
    <div className="mt-4 flex gap-2" aria-label="交通方向">{directions.map((value) => <button type="button" key={value} aria-pressed={direction === value} onClick={() => onDirectionChange(value)} className={`${actionStyle} flex-1 sm:flex-none ${direction === value ? "bg-sage text-white hover:bg-focus" : "bg-white"}`}>{directionLabels[value]}</button>)}</div>
    {directions.map((value) => <DirectionSection key={`${tripId}/${value}`} tripId={tripId} plan={plan} direction={value} hidden={direction !== value} onSaved={onSaved} />)}
  </section>;
}
