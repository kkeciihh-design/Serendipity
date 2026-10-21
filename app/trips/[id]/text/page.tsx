import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { tripDisplayTitle } from "@/lib/trip-title";
import { coverPhotoForDestination } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";
import { TripExportNav, TripWorkshopNav } from "@/app/components/trip-export-nav";
import { TextExportPanel } from "@/app/components/text-export-panel";

export const dynamic = "force-dynamic";

export default async function TextPage({ params }: { params: Promise<{ id: string }> }) {
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
      <EditorialCover photo={photo} nav={<TripWorkshopNav tripId={id} />} title="文字导出" note={<>把每日安排、交通、时间红线和清单带到备忘录或聊天中。保留预算、来源与待确认事项，随时翻阅。<span className="mt-1 block text-sm text-white/75">{displayTitle}</span></>} />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <TripExportNav tripId={id} current="text" />
        <TextExportPanel tripId={id} />
      </div>
    </main>
  );
}
