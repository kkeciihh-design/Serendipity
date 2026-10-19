"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, CalendarDays, MapPin, MapPinned, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { businessFetch } from "@/lib/business-fetch";
import styles from "./trips.module.css";

type TripCard = {
  id: string;
  title: string;
  originalQuote: string;
  destination: string;
  days: number | null;
  dates: string;
  travelers: string | null;
  status: string;
  isReady: boolean;
  versionNumber: number | null;
};

export function TripCollection({ trips }: { trips: TripCard[] }) {
  const router = useRouter();
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [deletingTrip, setDeletingTrip] = useState<TripCard | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef(false);
  const visibleTrips = trips.filter((trip) => !deletedIds.includes(trip.id));

  useEffect(() => {
    if (!deletingTrip) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    // React's autoFocus runs while the newly mounted dialog is still closed.
    // Choose the non-destructive action after showModal makes it focusable.
    cancelButtonRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    };
  }, [deletingTrip]);

  const dismissDelete = () => {
    if (pendingRef.current) return;
    setDeletingTrip(null);
    setError(null);
  };

  const confirmDelete = async () => {
    if (!deletingTrip || pendingRef.current) return;
    const trip = deletingTrip;
    pendingRef.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      const response = await businessFetch(`/api/trips/${trip.id}`, { method: "DELETE" });
      // A trip removed in another tab should also disappear from this list.
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "删除失败，这趟旅行仍然保留，请稍后重试。");
      }
      setDeletedIds((ids) => [...ids, trip.id]);
      setAnnouncement(`已删除「${trip.title}」。`);
      setDeletingTrip(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，这趟旅行仍然保留，请稍后重试。");
    } finally {
      pendingRef.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <section className={styles.collection} aria-labelledby="trips-title">
      <div className={styles.sectionHeading}>
        <div>
          <p className={styles.eyebrow}>YOUR PERSONAL ATLAS<span>旅程收藏</span></p>
          <h1 ref={headingRef} id="trips-title" tabIndex={-1} className={styles.title}>我的旅行</h1>
          <p className={styles.description}>把想去的地方，写成值得期待的每一天。</p>
        </div>
        <p className={styles.collectionCount} data-testid="trip-collection-count" aria-live="polite"><span>{String(visibleTrips.length).padStart(2, "0")}</span>趟旅行，等待出发</p>
      </div>
      <p className="sr-only" role="status">{announcement}</p>

      {visibleTrips.length === 0 ? (
        <div className={styles.emptyState}>
          <MapPinned aria-hidden="true" size={30} />
          <h2>还没有保存的旅行</h2>
          <p>从一句向往开始，让 AI 为你排好下一趟旅程。</p>
          <Link href="/#trip-input" className={styles.newTrip}>开始创建旅行<ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      ) : (
        <ul className={styles.tripGrid}>
          {visibleTrips.map((trip, index) => (
            <li key={trip.id}>
              <article className={styles.tripCard} data-trip-id={trip.id}>
                <Link href={`/trips/${trip.id}`} className={styles.cardLink}>
                  <div className={styles.cardTopline}><span className={styles.folio}>JOURNEY {String(index + 1).padStart(2, "0")}</span><span className={`${styles.status} ${trip.isReady ? styles.statusReady : ""}`}>{trip.status}</span></div>
                  <div className={styles.destinationLine}><MapPin aria-hidden="true" size={14} /><span>{trip.destination}</span>{trip.days ? <span className={styles.dayCount}>{trip.days} 天</span> : null}</div>
                  <h2>{trip.title}</h2>
                  {trip.originalQuote !== trip.title ? <blockquote className={styles.cardDescription} title={trip.originalQuote} aria-label="出发灵感">“{trip.originalQuote}”</blockquote> : null}
                  <div className={styles.tripFacts}><span><CalendarDays aria-hidden="true" size={13} />{trip.dates}</span>{trip.travelers ? <span>{trip.travelers}</span> : null}</div>
                  <p className={styles.versionNote}>{trip.versionNumber ? `第 ${trip.versionNumber} 版行程` : "从一句向往出发"}</p>
                </Link>
                <div className={styles.cardBottom}>
                  <button type="button" className={styles.deleteButton} aria-label={`删除旅行：${trip.title}`} onClick={() => { setError(null); setDeletingTrip(trip); }}><Trash2 aria-hidden="true" size={13} />删除</button>
                  <Link href={`/trips/${trip.id}`} className={styles.openLink}>打开继续<ArrowUpRight aria-hidden="true" size={16} /></Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {deletingTrip ? (
        <dialog ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="delete-collection-trip-title" aria-describedby="delete-collection-trip-description" className={styles.deleteDialog} onCancel={(event) => { event.preventDefault(); dismissDelete(); }}>
          <div className={styles.dialogHeading}><h2 id="delete-collection-trip-title">删除这趟旅行？</h2><button type="button" className={styles.dialogClose} aria-label="关闭删除确认" disabled={isDeleting} onClick={dismissDelete}><X aria-hidden="true" size={18} /></button></div>
          <p id="delete-collection-trip-description">「{deletingTrip.title}」及其行程版本将被删除，此操作无法恢复。</p>
          {error ? <p role="alert" className={styles.deleteError}>{error}</p> : null}
          <div className={styles.dialogActions}>
            <button ref={cancelButtonRef} type="button" className={styles.cancelButton} disabled={isDeleting} onClick={dismissDelete}>保留旅行</button>
            <button type="button" className={styles.confirmDeleteButton} disabled={isDeleting} onClick={confirmDelete}><Trash2 aria-hidden="true" size={14} />{isDeleting ? "正在删除…" : "确认删除"}</button>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
