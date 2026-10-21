import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { tripDisplayTitle } from "@/lib/trip-title";
import { coverPhotoForDestination } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";
import { TripExportNav, TripWorkshopNav } from "@/app/components/trip-export-nav";
import { ExecutionPanel } from "@/app/components/execution-panel";

export const dynamic = "force-dynamic";

export default async function ExecutePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess();
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) notFound();
  const request = await getTripRequestRecord(id);
  const snapshot = request.confirmedRequest ?? request.extractedRequest;
  const displayTitle = tripDisplayTitle({ title: trip.title, originalRequest: request.originalRequest, snapshot });
  const photo = coverPhotoForDestination(snapshot?.destination, request.originalRequest);

  return (
    <main className="min-h-dvh bg-cream pb-28">
      <EditorialCover photo={photo} nav={<TripWorkshopNav tripId={id} execution />} title="旅行执行模式" note={<>按每天的安排从容出发，随时核对下一站与返程时间。<span className="mt-1 block text-sm text-white/75">{displayTitle}</span></>} />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {trip.currentPlanVersionId ? <TripExportNav tripId={id} /> : null}
        {trip.currentPlanVersionId ? <ExecutionPanel tripId={id} /> : <p className="mt-6 rounded-2xl border border-[#18221D]/10 bg-white p-5 shadow-sm">还没有旅行计划。返回旅行确认需求并生成计划后即可开始。</p>}
      </div>
    </main>
  );
}
