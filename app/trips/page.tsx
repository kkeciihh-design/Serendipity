import Link from "next/link";
import { ArrowRight, FilePlus2, MapPinned, Settings } from "lucide-react";
import { requirePageAppAccess } from "@/lib/page-access";
import { listTrips } from "@/lib/trips";
import { formatTripDateTime, summarizeRequest } from "@/lib/trip-format";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  await requirePageAppAccess();

  const trips = await listTrips();

  return (
    <main className="min-h-dvh bg-cream">
      <header className="border-b border-sand/80 bg-shell px-5 py-5 sm:px-10 lg:px-16">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-sage">Serendipity</p>
            <h1 className="text-2xl font-bold text-charcoal">我的旅行</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-md border border-sand px-4 py-2 text-sm font-medium text-graphite transition-colors hover:border-sage hover:text-sage"
            >
              返回首页
            </Link>
            <Link
              href="/#trip-input"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-focus"
            >
              <FilePlus2 aria-hidden="true" className="size-4" />
              新建旅行
            </Link>
            <Link
              href="/settings"
              title="个人设置"
              aria-label="个人设置"
              className="inline-flex min-h-11 w-11 items-center justify-center rounded-md border border-sand text-graphite transition-colors hover:border-sage hover:text-sage"
            >
              <Settings aria-hidden="true" className="size-5" />
            </Link>
          </div>
        </div>
      </header>

      <section className="px-5 py-8 sm:px-10 sm:py-12 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm leading-6 text-graphite">
            旅行草稿保存在本机数据库中，重启应用后仍会保留。这里只保存原话和标题，本阶段还没有解析需求或生成行程。
          </p>

          {trips.length === 0 ? (
            <div className="mt-8 border border-dashed border-sand bg-white/70 px-5 py-10 text-center">
              <MapPinned
                aria-hidden="true"
                className="mx-auto size-8 text-sage"
              />
              <h2 className="mt-4 text-xl font-semibold text-charcoal">
                还没有保存的旅行
              </h2>
              <p className="mx-auto mt-2 max-w-md text-base leading-7 text-graphite">
                从一句话开始。保存后这里会显示每趟旅行，点开就能继续修改。
              </p>
              <Link
                href="/#trip-input"
                className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-md bg-sage px-5 py-3 text-base font-semibold text-white transition-colors hover:bg-focus"
              >
                开始创建旅行
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          ) : (
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {trips.map((trip) => (
                <li key={trip.id} className="h-full">
                  <article className="flex h-full flex-col rounded-lg border border-sand/80 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <span className="rounded-md bg-sage-soft px-3 py-2 text-sm font-medium text-sage">
                        草稿
                      </span>
                      <span className="text-sm text-graphite">
                        修改于 {formatTripDateTime(trip.updatedAt)}
                      </span>
                    </div>
                    <h2 className="mt-4 text-xl font-semibold text-charcoal">
                      {trip.title}
                    </h2>
                    <p className="mt-3 flex-1 text-base leading-7 text-graphite">
                      {summarizeRequest(trip.originalRequest)}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-sand/80 pt-4">
                      <p className="text-sm leading-6 text-graphite">
                        创建于 {formatTripDateTime(trip.createdAt)}
                      </p>
                      <Link
                        href={`/trips/${trip.id}`}
                        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-sage px-4 py-2 text-sm font-semibold text-sage transition-colors hover:bg-sage-soft"
                      >
                        打开继续
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
