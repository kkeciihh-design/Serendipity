"use client";
import Link from "next/link";
import { CalendarDays, ListChecks, Map, MoreHorizontal, Wallet } from "lucide-react";
const links = [["timeline", "行程", CalendarDays], ["map", "地图", Map], ["checklist", "清单", ListChecks], ["budget", "预算", Wallet], ["more", "更多", MoreHorizontal]] as const;
export function TripBottomNav({ tripId, active, onSelect }: { tripId: string; active?: string; onSelect?: (view: typeof links[number][0]) => void }) {
  return <nav aria-label="旅行底部导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-sand bg-cream/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
    <div className="mx-auto grid max-w-lg grid-cols-5">{links.map(([view, label, Icon]) => {
      const style = `flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg text-xs font-semibold ${active === view ? "text-sage" : "text-graphite"}`;
      const content = <><Icon aria-hidden="true" className="size-5" />{label}</>;
      return onSelect ? <button key={view} type="button" className={style} aria-current={active === view ? "page" : undefined} onClick={() => onSelect(view)}>{content}</button>
        : <Link key={view} className={style} href={`/trips/${tripId}?view=${view}#plan-views`}>{content}</Link>;
    })}</div>
  </nav>;
}
