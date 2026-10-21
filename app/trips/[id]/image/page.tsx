import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { tripDisplayTitle } from "@/lib/trip-title";
import { coverPhotoForDestination } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";
import { TripExportNav, TripWorkshopNav } from "@/app/components/trip-export-nav";
import { LongImagePanel } from "@/app/components/long-image-panel";

export const dynamic = "force-dynamic";

export default async function LongImagePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAppAccess();
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) notFound();
  const request = await getTripRequestRecord(id);
  const snapshot = request.confirmedRequest ?? request.extractedRequest;
  const displayTitle = tripDisplayTitle({ title: trip.title, originalRequest: request.originalRequest, snapshot });
  const photo = coverPhotoForDestination(snapshot?.destination, request.originalRequest);

  return (
    <main className="min-h-dvh bg-cream">
      <EditorialCover photo={photo} nav={<TripWorkshopNav tripId={id} />} title="旅行长图" note={<>把时间轴、位置、红线和预算保存成清晰竖图。按顺序翻阅，旅途中随时查看。<span className="mt-1 block text-sm text-white/75">{displayTitle}</span></>} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <TripExportNav tripId={id} current="image" />
        <LongImagePanel tripId={id} />
      </div>
    </main>
  );
}
