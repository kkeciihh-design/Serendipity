import { ChevronDown, MapPinned } from "lucide-react";

export type SampleTrip = {
  title: string;
  destination: string;
  duration: string;
  style: string;
  highlights: string[];
};

export function SampleTripCard({ trip }: { trip: SampleTrip }) {
  return (
    <article className="flex h-full flex-col rounded-lg border border-sand/70 bg-white p-5 shadow-[0_1px_2px_rgba(35,42,38,0.06)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-md bg-sage-soft px-3 py-2 text-sm font-medium text-sage">
          <MapPinned aria-hidden="true" className="size-4" />
          {trip.destination}
        </span>
        <span className="text-sm text-graphite">{trip.duration}</span>
      </div>
      <h3 className="mt-4 text-xl font-semibold text-charcoal">{trip.title}</h3>
      <p className="mt-2 text-base leading-7 text-graphite">{trip.style}</p>
      <details className="group mt-5 border-t border-sand/80 pt-4">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-1 text-base font-medium text-sage transition-colors group-open:text-clay">
          查看样例内容
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180"
          />
        </summary>
        <ul className="mt-3 space-y-2 text-base leading-7 text-graphite">
          {trip.highlights.map((highlight) => (
            <li key={highlight} className="pl-4">
              {highlight}
            </li>
          ))}
        </ul>
      </details>
      <p className="mt-4 text-sm leading-6 text-graphite/85">
        展示样例：内容为人工编写，不包含实时价格、开放状态或预约信息。
      </p>
    </article>
  );
}
