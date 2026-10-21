import { Clock3, MapPin, Wallet } from "lucide-react";
import { formatMoneyRange } from "@/lib/budget";
import { sanitizeTravelerText } from "@/lib/content-sanitizer";
import type { PlanEvent } from "@/lib/plan";

/** Read the traveller's saved guide without implying catalogue verification. */
export function ItineraryArrangementCard({ event, kind }: { event: PlanEvent; kind: "attraction" | "restaurant" }) {
  const meal = kind === "restaurant";
  const groups = new Map<string, string[]>();
  const note = sanitizeTravelerText(event.note);
  for (const sentence of note.split(/(?<=[。；;！!？?])\s*|\n+/).filter(Boolean)) {
    const label = /预约|预订|购票|实名|门票/.test(sentence) ? "开放与预约" :
      /开放|营业|闭馆|闭园|开门|关门/.test(sentence) ? "开放与预约" :
      meal && /菜|小吃|口味|点单|推荐|必吃|尝|面线|姜母鸭|牛肉|海鲜|人均/.test(sentence) ? "推荐菜品与点单" :
      /动线|路线|步行|沿|依次|先.*再|入口|出口|街巷|游览|参观/.test(sentence) ? "游览动线" : "实用贴士";
    groups.set(label, [...(groups.get(label) ?? []), sentence]);
  }
  return <section aria-label="当前行程安排档案卡" className="overflow-hidden rounded-2xl border border-sand/80 bg-white shadow-sm">
    <div className="border-b border-sand/60 bg-sage-soft/40 px-5 py-4">
      <p className="text-xs font-semibold tracking-wide text-sage">当前行程安排档案</p>
      <h3 className="mt-2 text-lg font-semibold text-charcoal">{event.title}</h3>
      <p className="mt-1 text-xs leading-5 text-graphite">来自本版行程，开放、预约与实际{meal ? "门店" : "票价"}信息请在出发前核对。</p>
    </div>
    <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
      <div><dt className="flex items-center gap-1.5 text-xs text-graphite"><Clock3 size={14} aria-hidden="true" />安排时段</dt><dd className="mt-1 font-medium">{event.date} · {event.startTime}–{event.endDate && event.endDate !== event.date ? `${event.endDate} ` : ""}{event.endTime}</dd></div>
      <div><dt className="flex items-center gap-1.5 text-xs text-graphite"><Wallet size={14} aria-hidden="true" />预估费用</dt><dd className="mt-1 font-medium">{formatMoneyRange(event.costDraftCents, event.costDraftCents)}{meal ? " · 本餐预算参考" : " · 行程预算参考"}</dd></div>
      <div className="sm:col-span-2"><dt className="flex items-center gap-1.5 text-xs text-graphite"><MapPin size={14} aria-hidden="true" />地点</dt><dd className="mt-1 leading-6">{sanitizeTravelerText(event.locationName) || "地点待确认"}</dd></div>
    </dl>
    {groups.size ? <div className="space-y-4 border-t border-sand/60 px-5 py-5">{[...groups].map(([label, sentences]) => <section key={label}><h4 className="text-sm font-semibold text-sage">{label}</h4><p className="mt-1.5 whitespace-pre-wrap text-sm leading-7 text-graphite">{sentences.join(" ")}</p></section>)}</div> : null}
  </section>;
}
