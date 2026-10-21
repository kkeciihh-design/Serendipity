import Link from "next/link";
import { FilePlus2, Settings } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { listTrips } from "@/lib/trips";
import { readTripSummarySnapshot, tripSummaryDates, tripSummaryDays, tripSummaryTravelers } from "@/lib/trip-summary";
import { resolveDestination } from "@/lib/destination-inference";
import { parsePlanEvents, stopPreview } from "@/lib/stop-preview";
import { tripDisplayTitle } from "@/lib/trip-title";
import { activeCoverPhoto } from "@/lib/cover-destination";
import { EditorialCover } from "@/app/components/editorial-cover";
import { TripCollection } from "./trip-collection";
import styles from "./trips.module.css";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  await requirePageAppAccess();
  const trips = await listTrips();
  const cards = trips.map((trip) => {
    const confirmed = trip.request?.confirmedRevision === trip.request?.requestRevision && Boolean(trip.request?.confirmedRequest);
    const plan = trip.currentPlanVersion;
    const snapshot = (confirmed ? readTripSummarySnapshot(trip.request?.confirmedRequest) : null)
      ?? readTripSummarySnapshot(plan?.requestSnapshot)
      ?? readTripSummarySnapshot(trip.request?.extractedRequest);
    const originalRequest = trip.request?.originalRequest ?? trip.originalRequest;
    const needsUpdate = Boolean(plan && (!plan.requirementUpToDate || plan.requestRevision !== trip.request?.requestRevision));
    // A stored placeholder must not hide a destination the traveller already named.
    const destination = resolveDestination(snapshot?.destination, originalRequest);
    const title = tripDisplayTitle({ title: trip.title, originalRequest, snapshot, destination });
    return {
      id: trip.id,
      // Pass the resolved destination so the title never degrades to 下一站.
      title,
      // The card's own headline: the destination-led display title when we have
      // one, else the stored title.
      tripTitle: title,
      originalQuote: originalRequest.replace(/\s+/g, " ").trim(),
      destination,
      days: tripSummaryDays(snapshot),
      dates: tripSummaryDates(snapshot),
      travelers: tripSummaryTravelers(snapshot, confirmed || !plan ? originalRequest : undefined),
      status: plan ? needsUpdate ? "行程待更新" : "行程已就绪" : confirmed ? "需求已确认" : trip.request?.extractedRequest ? "待完善需求" : "旅行灵感",
      isReady: Boolean(plan && !needsUpdate),
      versionNumber: plan?.versionNumber ?? null,
      stops: stopPreview(parsePlanEvents(plan?.events)),
    };
  });

  return (
    <main className={styles.page}>
      {/* The count is part of the cover subtitle; the collection starts
          directly on the warm-white work surface below. */}
      <EditorialCover
        photo={activeCoverPhoto()}
        title="我的旅行"
        // TripCollection renders the page's own focusable `#trips-title` <h1>
        // (trips.spec.ts drives it), so the cover repeats the words without
        // emitting a second top-level heading.
        titleIsNotHeading
        note={`把想去的地方写成值得期待的每一天 · 共 ${trips.length} 趟旅行`}
        nav={
          <>
            <Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/">
              ← 返回首页
            </Link>
            <span className="font-serif text-sm tracking-wide text-white/75">Serendipity · 个人旅行规划工作室</span>
          </>
        }
        actions={
          <>
            <Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/#trip-input">
              <FilePlus2 aria-hidden="true" size={14} />新建旅行
            </Link>
            <Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/settings" title="个人设置" aria-label="个人设置">
              <Settings aria-hidden="true" size={14} />个人设置
            </Link>
          </>
        }
      />

      <div className={styles.pageBody}>
        <TripCollection trips={cards} />
        <footer className={styles.footer}><span>Serendipity</span><span>山水之间，自有方向。</span></footer>
      </div></main>
  );
}
