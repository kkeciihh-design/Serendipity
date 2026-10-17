import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { ExecutionPanel } from "@/app/components/execution-panel";
export const dynamic = "force-dynamic";
export default async function ExecutePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess();
  const { id } = await params, trip = await getTrip(id);
  if (!trip) notFound();
  return <main className="min-h-dvh bg-cream px-4 pt-5 pb-28 sm:px-8 sm:py-10">
    <div className="mx-auto max-w-3xl">
      <Link className="inline-flex min-h-11 items-center text-sm text-sage underline" href={`/trips/${id}`}>退出执行模式 · 返回旅行</Link>
      <p className="mt-3 text-xs font-semibold tracking-widest text-sage">SERENDIPITY · ON THE WAY</p>
      <h1 className="mt-2 text-2xl font-semibold text-charcoal sm:text-3xl">旅行执行模式</h1>
      <p className="mt-2 break-words text-graphite">{trip.title}</p>
      {trip.currentPlanVersionId ? <ExecutionPanel tripId={id} /> : <p className="mt-6 rounded-xl bg-white p-5">还没有旅行计划。返回旅行确认需求并生成计划后即可开始。</p>}
    </div>
  </main>;
}
