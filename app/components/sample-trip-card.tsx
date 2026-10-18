import { ArrowDownRight, MapPinned } from "lucide-react";
import { DestinationPlate, destinationCaptions } from "./destination-plate";
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
      <div aria-hidden="true" className={styles.visual}>
        <DestinationPlate destination={trip.destination} />
        {issue ? (
          <span aria-hidden="true" className={styles.issue}>
            {issue}
          </span>
        ) : null}
        <div aria-hidden="true" className={styles.visualCaption}>
          <span>{destinationCaptions[trip.destination]?.name}</span>
          <span>{destinationCaptions[trip.destination]?.coordinates}</span>
        </div>
      </div>
      <div className={styles.body}>
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
            <span aria-hidden="true" className={styles.arrow}>
              <ArrowDownRight aria-hidden="true" />
            </span>
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
      </div>
    </article>
  );
}
