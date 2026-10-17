import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { PdfPanel } from "@/app/components/pdf-panel";
export const dynamic = "force-dynamic";
export default async function PdfPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess(); const { id } = await params; if (!await getTrip(id)) notFound();
  return <main className="min-h-dvh bg-cream px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap gap-x-6"><Link href={`/trips/${id}`} className="inline-flex min-h-11 items-center text-sage underline">返回旅行</Link><Link href={`/trips/${id}/image`} className="inline-flex min-h-11 items-center text-sage underline">旅行长图</Link><Link href={`/trips/${id}/mobile`} className="inline-flex min-h-11 items-center text-sage underline">手机一页版</Link><Link href={`/trips/${id}/text`} className="inline-flex min-h-11 items-center text-sage underline">文字导出</Link></div>
    <p className="mt-4 text-xs font-semibold tracking-widest text-sage">SERENDIPITY · TRAVEL HANDBOOK</p><h1 className="mt-2 text-3xl font-semibold text-charcoal">PDF旅行手册</h1>
    <p className="mt-3 max-w-2xl leading-7 text-graphite">把每日地图、安排、红线和旅行准备装订成册。保存一份，安心出发。</p><PdfPanel tripId={id} />
  </div></main>;
}
