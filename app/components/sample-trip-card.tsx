import { ArrowUpRight } from "lucide-react";
import type { SampleTrip } from "@/lib/home-samples";
import styles from "./sample-trip-card.module.css";

export type { SampleTrip } from "@/lib/home-samples";

export function SampleTripCard({
  trip,
  issue,
}: {
  trip: SampleTrip;
  issue?: string;
}) {
  return (
    <article className={styles.card} data-testid="sample-trip-card">
      <div
        className={styles.preview}
        data-destination={trip.destinationLatin}
        data-testid="sample-trip-preview"
      >
        <div className={styles.ticketHeader}>
          <p className={styles.destination}>
            {issue ? <span className={styles.issue}>{issue} / </span> : null}
            {trip.destinationLatin} <span className={styles.city}>· {trip.destination}</span>
          </p>
          <span className={styles.duration}>{trip.duration}</span>
        </div>
        <ol className={styles.miniTimeline} aria-label={`${trip.destination}路线预览`}>
          {trip.preview.map((stop) => (
            <li key={stop.title}>
              <span className={styles.previewDay}>{stop.day}</span>
              <span className={styles.previewDot} aria-hidden="true" />
              <span className={styles.previewTitle}>{stop.title}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className={styles.body}>
        <h3 className={styles.title}>{trip.title}</h3>
        <p className={styles.description}>{trip.style}</p>
        <details className={styles.details}>
          <summary className={styles.summary}>
            <span className={styles.expandLabel}>展开完整样本</span>
            <span className={styles.collapseLabel}>收起完整样本</span>
            <ArrowUpRight aria-hidden="true" className={styles.arrow} />
          </summary>
          <div className={styles.expanded} data-testid="sample-trip-details">
            <ol className={styles.dayTimeline} aria-label={`${trip.destination}逐日行程`}>
              {trip.days.map((day) => (
                <li key={day.day}>
                  <p className={styles.dayLabel}>{day.day}</p>
                  <h4 className={styles.dayTitle}>{day.title}</h4>
                  <p className={styles.route}>{day.route}</p>
                  <p className={styles.rhythm}>{day.rhythm}</p>
                </li>
              ))}
            </ol>
            <div className={styles.checks}>
              <p className={styles.checksHeading}>
                <span aria-hidden="true" /> 出发前，再确认一遍
              </p>
              <dl>
                <div>
                  <dt>交通接驳</dt>
                  <dd>{trip.transport}</dd>
                </div>
                <div>
                  <dt>门票核验</dt>
                  <dd>{trip.tickets}</dd>
                </div>
              </dl>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}
