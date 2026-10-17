import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { LongImagePanel } from "@/app/components/long-image-panel";
export const dynamic = "force-dynamic";
export default async function LongImagePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess(); const { id } = await params; if (!await getTrip(id)) notFound();
  return <main className="min-h-dvh bg-cream px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap gap-x-6"><Link href={`/trips/${id}`} className="inline-flex min-h-11 items-center text-sage underline">返回旅行</Link><Link href={`/trips/${id}/pdf`} className="ml-6 inline-flex min-h-11 items-center text-sage underline">PDF旅行手册</Link><Link href={`/trips/${id}/mobile`} className="inline-flex min-h-11 items-center text-sage underline">手机一页版</Link><Link href={`/trips/${id}/text`} className="inline-flex min-h-11 items-center text-sage underline">文字导出</Link></div>
    <p className="mt-4 text-xs font-semibold tracking-widest text-sage">SERENDIPITY · TAKE IT WITH YOU</p><h1 className="mt-2 text-3xl font-semibold text-charcoal">旅行长图</h1>
    <p className="mt-3 max-w-2xl leading-7 text-graphite">把时间轴、位置、红线和预算保存成清晰竖图。按顺序翻阅，旅途中随时查看。</p><LongImagePanel tripId={id} />
  </div></main>;
}
