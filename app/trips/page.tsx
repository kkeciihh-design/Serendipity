import Link from "next/link";
import { FilePlus2, Settings } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { listTrips } from "@/lib/trips";
import { readTripSummarySnapshot, tripSummaryDates, tripSummaryDays, tripSummaryTravelers } from "@/lib/trip-summary";
import { tripDisplayTitle } from "@/lib/trip-title";
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
    return {
      id: trip.id,
      title: tripDisplayTitle({ title: trip.title, originalRequest, snapshot }),
      originalQuote: originalRequest.replace(/\s+/g, " ").trim(),
      destination: snapshot?.destination ?? "目的地待补充",
      days: tripSummaryDays(snapshot),
      dates: tripSummaryDates(snapshot),
      travelers: tripSummaryTravelers(snapshot, confirmed || !plan ? originalRequest : undefined),
      status: plan ? needsUpdate ? "行程待更新" : "行程已就绪" : confirmed ? "需求已确认" : trip.request?.extractedRequest ? "待完善需求" : "旅行灵感",
      isReady: Boolean(plan && !needsUpdate),
      versionNumber: plan?.versionNumber ?? null,
    };
  });

  return (
    <main className={styles.page}>
      <header className={styles.navigation}>
        <Link href="/" className={styles.brand}><span className={styles.wordmark}>Serendipity</span><span>个人旅行规划工作室</span></Link>
        <nav className={styles.navigationActions} aria-label="主导航">
          <Link href="/" className={styles.navigationLink}>返回首页</Link>
          <Link href="/#trip-input" className={styles.newTrip}><FilePlus2 aria-hidden="true" size={14} />新建旅行</Link>
          <Link href="/settings" title="个人设置" aria-label="个人设置" className={styles.settingsLink}><Settings aria-hidden="true" size={17} /></Link>
        </nav>
      </header>

      <TripCollection trips={cards} />
      <footer className={styles.footer}><span>Serendipity</span><span>山水之间，自有方向。</span></footer>
    </main>
  );
}
