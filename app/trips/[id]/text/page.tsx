import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { TextExportPanel } from "@/app/components/text-export-panel";
export const dynamic = "force-dynamic";
export default async function TextPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess();
  const { id } = await params;
  if (!await getTrip(id)) notFound();
  return <main className="min-h-dvh bg-cream px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-center gap-x-6"><Link href={`/trips/${id}`} className="inline-flex min-h-11 items-center text-sage underline">返回旅行</Link><Link href={`/trips/${id}/pdf`} className="ml-6 inline-flex min-h-11 items-center text-sage underline">PDF旅行手册</Link><Link href={`/trips/${id}/image`} className="mr-6 inline-flex min-h-11 items-center text-sage underline">旅行长图</Link><Link href={`/trips/${id}/mobile`} className="inline-flex min-h-11 items-center text-sage underline">手机一页版</Link></div>
    <p className="mt-4 text-xs font-semibold tracking-widest text-sage">SERENDIPITY · TAKE IT WITH YOU</p>
    <h1 className="mt-2 text-3xl font-semibold text-charcoal">文字导出</h1>
    <p className="mt-3 max-w-2xl text-base leading-7 text-graphite">把每日安排、交通、时间红线和清单带到备忘录或聊天中。保留预算、来源与待确认事项，随时翻阅。</p>
    <TextExportPanel tripId={id} />
  </div></main>;
}
