import { ChevronDown, MapPinned } from "lucide-react";
import styles from "./sample-trip-card.module.css";

export type SampleTrip = {
  title: string;
  destination: string;
  duration: string;
  style: string;
  highlights: string[];
};

export function SampleTripCard({
  trip,
  issue,
}: {
  trip: SampleTrip;
  issue?: string;
}) {
  return (
    <article className={styles.card}>
      <div aria-hidden="true" className={styles.contours} />
      {issue ? (
        <span aria-hidden="true" className={styles.issue}>
          {issue}
        </span>
      ) : null}
      <div className={styles.ticketHeader}>
        <span className={styles.destination}>
          <MapPinned aria-hidden="true" className="size-4" />
          {trip.destination}
        </span>
        <span className={styles.duration}>{trip.duration}</span>
      </div>
      <h3 className={styles.title}>{trip.title}</h3>
      <p className={styles.description}>{trip.style}</p>
      <details className={styles.details}>
        <summary className={styles.summary}>
          查看样例内容
          <ChevronDown
            aria-hidden="true"
            className={styles.chevron}
          />
        </summary>
        <ul className={styles.highlights}>
          {trip.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      </details>
      <p className={styles.footnote}>
        展示样例：内容为人工编写，不包含实时价格、开放状态或预约信息。
      </p>
    </article>
  );
}
