import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { tripDisplayTitle } from "@/lib/trip-title";
import { coverPhotoForDestination } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";
import { TripExportNav, TripWorkshopNav } from "@/app/components/trip-export-nav";
import { MobileExportPanel } from "@/app/components/mobile-export-panel";

export const dynamic = "force-dynamic";

export default async function MobilePage({ params }: { params: Promise<{ id: string }> }) {
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
      <EditorialCover photo={photo} nav={<TripWorkshopNav tripId={id} />} title="手机一页版" note={<>把每天的行动安排存成一份随身资料。按天跳转，断网也能阅读；旅行更新后可以重新生成。<span className="mt-1 block text-sm text-white/75">{displayTitle}</span></>} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <TripExportNav tripId={id} current="mobile" />
        <MobileExportPanel tripId={id} />
      </div>
    </main>
  );
}
