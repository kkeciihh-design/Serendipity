import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { MobileExportPanel } from "@/app/components/mobile-export-panel";
export const dynamic = "force-dynamic";
export default async function MobilePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess();
  const { id } = await params, trip = await getTrip(id);
  if (!trip) notFound();
  return <main className="min-h-dvh bg-cream px-4 py-6 sm:px-8 sm:py-10"><div className="mx-auto max-w-6xl">
    <Link href={`/trips/${id}`} className="inline-flex min-h-11 items-center text-sage underline">返回旅行</Link><Link href={`/trips/${id}/pdf`} className="ml-6 inline-flex min-h-11 items-center text-sage underline">PDF旅行手册</Link>
    <Link href={`/trips/${id}/text`} className="ml-6 inline-flex min-h-11 items-center text-sage underline">文字导出</Link>
    <p className="mt-4 text-xs font-semibold tracking-widest text-sage">SERENDIPITY · TAKE IT WITH YOU</p>
    <Link href={`/trips/${id}/image`} className="ml-6 inline-flex min-h-11 items-center text-sage underline">旅行长图</Link>
    <h1 className="mt-2 text-3xl font-semibold text-charcoal">手机一页版</h1>
    <p className="mt-3 max-w-2xl text-base leading-7 text-graphite">把每天的行动安排存成一份随身资料。按天跳转，断网也能阅读；旅行更新后可以重新生成。</p>
    <MobileExportPanel tripId={id} />
  </div></main>;
}
