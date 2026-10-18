"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { samplePhotography } from "@/lib/destination-gallery";
import type { SampleTrip } from "@/lib/home-samples";
import { LandscapeSketch } from "./landscape-sketch";
import { SampleTripDialog } from "./sample-trip-dialog";
import styles from "./sample-trip-card.module.css";

export type { SampleTrip } from "@/lib/home-samples";

export function SampleTripCard({
  trip,
  issue,
  mode = "photo",
}: {
  trip: SampleTrip;
  issue?: string;
  mode?: "photo" | "sketch";
}) {
  const [open, setOpen] = useState(false);
  const photo = samplePhotography[trip.destination as keyof typeof samplePhotography];
  return (
    <>
    <article className={styles.card} data-testid="sample-trip-card">
      <button
        type="button"
        className={styles.openButton}
        aria-label={`查看完整规划：${trip.title}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <div
        className={styles.preview}
        data-destination={trip.destinationLatin}
        data-testid="sample-trip-preview"
        data-aesthetic={mode}
      >
        <div className={styles.landscape} aria-hidden="true">
          {mode === "photo" && photo ? (
            <Image fill src={photo.src} alt="" sizes="(max-width: 800px) 100vw, 400px" className={styles.photo} style={{ objectPosition: photo.position }} />
          ) : (
            <LandscapeSketch scene={trip.destinationLatin.toLowerCase()} className={styles.sketch} />
          )}
        </div>
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
        <div className={styles.summary} aria-hidden="true">
            <span>查看完整规划</span>
            <ArrowUpRight aria-hidden="true" className={styles.arrow} />
        </div>
      </div>
    </article>
    {open ? <SampleTripDialog trip={trip} issue={issue} mode={mode} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
