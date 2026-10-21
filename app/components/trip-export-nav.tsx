import Link from "next/link";

const formats = [
  ["mobile", "📱 手机离线一页"],
  ["pdf", "📖 PDF 旅行手册"],
  ["image", "🖼️ 旅行长图"],
  ["text", "📝 文字与 Markdown"],
] as const;

export function TripExportNav({ tripId, current }: { tripId: string; current?: (typeof formats)[number][0] }) {
  return (
    <nav aria-label="随身路书导出格式" className="inline-flex max-w-full flex-wrap gap-1.5 rounded-2xl border border-[#18221D]/10 bg-[#EFECE6] p-1.5">
      {formats.map(([format, label]) => (
        <Link key={format} href={`/trips/${tripId}/${format}`} aria-current={format === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B362A] ${format === current ? "bg-[#1B362A] text-white shadow-sm" : "text-[#4A5850] hover:bg-white/70 hover:text-[#141E19]"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function TripWorkshopNav({ tripId, execution = false }: { tripId: string; execution?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href={`/trips/${tripId}`} className="inline-flex min-h-11 items-center rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/25">
        ← 返回旅行详情
      </Link>
      <span className="text-sm tracking-wide text-white/80">Serendipity · {execution ? "旅途执行伴侣" : "随身路书工坊"}</span>
    </div>
  );
}
