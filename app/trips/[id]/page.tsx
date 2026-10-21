import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAppAccess } from "@/lib/page-access";
import { TripEditor } from "@/app/components/trip-editor";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { listPlanVersions } from "@/lib/plan-service";
import { listEvidenceFacts } from "@/lib/evidence-service";
import { tripDisplayTitle } from "@/lib/trip-title";
import { resolveDestination } from "@/lib/destination-inference";
import { coverPhotoForDestination } from "@/lib/cover-destination";
import { TripDeleteButton } from "../trip-delete-button";
import styles from "../trips.module.css";

export const dynamic = "force-dynamic";

type TripDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ planVersion?: string; planningNotice?: string }>;
};

export default async function TripDetailPage({
  params,
  searchParams,
}: TripDetailPageProps) {
  await requirePageAppAccess();

  const { id } = await params;
  const { planVersion, planningNotice } = await searchParams;
  const trip = await getTrip(id);

  if (!trip) {
    notFound();
  }

  const request = await getTripRequestRecord(trip.id);
  const plans = await listPlanVersions(trip.id);
  const evidenceFacts = await listEvidenceFacts(trip.id);
  const plansWithEvidence = plans.map((plan) => ({
    ...plan,
    evidenceFacts: evidenceFacts.filter(
      (fact) => fact.planVersionId === plan.id,
    ),
  }));
  const parsedPlanVersion = planVersion ? Number(planVersion) : null;
  const selectedVersionNumber =
    parsedPlanVersion !== null &&
    Number.isInteger(parsedPlanVersion) &&
    plans.some((plan) => plan.versionNumber === parsedPlanVersion)
      ? parsedPlanVersion
      : null;
  const currentPlan = plans.find((plan) => plan.isCurrent) ?? plans[0];
  const confirmedSnapshot =
    request.confirmedRevision === request.requestRevision
      ? request.confirmedRequest
      : null;
  const summarySnapshot =
    confirmedSnapshot ?? currentPlan?.requestSnapshot ?? request.extractedRequest;
  const displayTitle = tripDisplayTitle({
    title: trip.title,
    originalRequest: request.originalRequest,
    snapshot: summarySnapshot,
    // Keep the detail title in step with the list card.
    destination: resolveDestination(summarySnapshot?.destination, request.originalRequest),
  });
  // The cover shows the landscape the traveller's own words point at, matched
  // against the built-in gallery (Hangzhou -> West Lake, Guilin -> Li River,
  // Fujian/Hongcun -> Xiapu or Hongcun, and so on). Never null.
  const coverPhoto = coverPhotoForDestination(
    summarySnapshot?.destination ?? resolveDestination(null, request.originalRequest, ""),
    request.originalRequest,
  );

  return (
    // The cover-width contract shared with the editorial cover header: the nav
    // band and the editor header line up on the same 1260px column.
    <main className={`${styles.detailPage} detail-page`}>
      <div className={`${styles.detailContent} detail-content`}>
        <TripEditor
          coverPhoto={coverPhoto}
          navigation={
            <nav className="mb-4 flex items-center justify-between gap-4 border-b border-white/15 pb-4" aria-label="旅行导航">
              <div className="flex min-w-0 items-center gap-4">
                <Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/trips">
                  ← 返回列表
                </Link>
                <span className="font-serif text-sm tracking-wide text-white/75">Serendipity · 个人旅行规划工作室</span>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <Link className="inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-white/20" href="/">
                  返回首页
                </Link>
                <TripDeleteButton tripId={trip.id} tripTitle={displayTitle} />
              </div>
            </nav>
          }
          key={trip.id}
          trip={{
            ...trip,
            createdAt: trip.createdAt.toISOString(),
            updatedAt: trip.updatedAt.toISOString(),
          }}
          request={request}
          plans={plansWithEvidence}
          selectedVersionNumber={selectedVersionNumber}
          planningNotice={typeof planningNotice === "string" ? planningNotice.slice(0, 600) : null}
        />
      </div>
    </main>
  );
}
