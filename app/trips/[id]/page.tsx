import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { TripEditor } from "@/app/components/trip-editor";
import { getTrip } from "@/lib/trips";

export const dynamic = "force-dynamic";

type TripDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TripDetailPage({ params }: TripDetailPageProps) {
  await requirePageAppAccess();

  const { id } = await params;
  const trip = await getTrip(id);

  if (!trip) {
    notFound();
  }

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
        />
      </div>
    </main>
  );
}
