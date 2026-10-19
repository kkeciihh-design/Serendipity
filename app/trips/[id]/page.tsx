import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { TripEditor } from "@/app/components/trip-editor";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { listPlanVersions } from "@/lib/plan-service";
import { listEvidenceFacts } from "@/lib/evidence-service";
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

  return (
    <main className={styles.detailPage}>
      <div className={styles.detailContent}>
        <nav className={styles.detailNavigation} aria-label="旅行导航">
        <Link
          href="/trips"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-graphite transition-colors hover:text-sage"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          返回我的旅行
        </Link>
        <Link href="/" className={styles.wordmark}>Serendipity</Link>
        </nav>
        <TripEditor
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
