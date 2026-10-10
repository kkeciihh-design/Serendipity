import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { TripEditor } from "@/app/components/trip-editor";
import { getTrip } from "@/lib/trips";
import { getTripRequestRecord } from "@/lib/trip-request-service";
import { listPlanVersions } from "@/lib/plan-service";
import { listEvidenceFacts } from "@/lib/evidence-service";

export const dynamic = "force-dynamic";

type TripDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ planVersion?: string }>;
};

export default async function TripDetailPage({
  params,
  searchParams,
}: TripDetailPageProps) {
  await requirePageAppAccess();

  const { id } = await params;
  const { planVersion } = await searchParams;
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
    <main className="min-h-dvh bg-cream px-5 py-8 sm:px-10 sm:py-12 lg:px-16">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/trips"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-1 text-sm font-medium text-graphite transition-colors hover:text-sage"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          返回我的旅行
        </Link>
        <TripEditor
          trip={{
            ...trip,
            createdAt: trip.createdAt.toISOString(),
            updatedAt: trip.updatedAt.toISOString(),
          }}
          request={request}
          plans={plansWithEvidence}
          selectedVersionNumber={selectedVersionNumber}
        />
      </div>
    </main>
  );
}
