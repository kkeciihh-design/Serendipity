"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, BrushCleaning, CalendarDays, MapPinned, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { businessFetch } from "@/lib/business-fetch";
import { coverPhotoForDestination } from "@/lib/cover-destination";
import styles from "./trips.module.css";

type TripCard = {
  id: string;
  title: string;
  /** Card-only display title: the detail heading joined to a duration phrase. */
  tripTitle: string;
  originalQuote: string;
  destination: string;
  days: number | null;
  dates: string;
  status: string;
  isReady: boolean;
  stops: string[];
};

export function TripCollection({ trips }: { trips: TripCard[] }) {
  const router = useRouter();
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [deletingTrip, setDeletingTrip] = useState<TripCard | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cleanupDialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const cleanupCancelButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingRef = useRef(false);
  const cleanupPendingRef = useRef(false);
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

  useEffect(() => {
    if (!isCleanupOpen) return;
    const dialog = cleanupDialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    cleanupCancelButtonRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    };
  }, [isCleanupOpen]);

  const dismissDelete = () => {
    if (pendingRef.current) return;
    setDeletingTrip(null);
    setError(null);
  };

  const dismissCleanup = () => {
    if (cleanupPendingRef.current) return;
    setIsCleanupOpen(false);
    setError(null);
  };

  const confirmCleanup = async () => {
    if (cleanupPendingRef.current) return;
    cleanupPendingRef.current = true;
    setIsCleaning(true);
    setError(null);
    try {
      const response = await businessFetch("/api/trips/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "清理失败，旅行资料保持不变，请稍后重试。");
      }
      const payload = await response.json() as { deletedCount: number; deletedTripIds: string[] };
      setDeletedIds((ids) => Array.from(new Set([...ids, ...payload.deletedTripIds])));
      setAnnouncement(payload.deletedCount
        ? `已清理 ${payload.deletedCount} 份重复或空白草稿。`
        : "当前没有需要清理的重复或空白草稿。");
      setIsCleanupOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "清理失败，旅行资料保持不变，请稍后重试。");
    } finally {
      cleanupPendingRef.current = false;
      setIsCleaning(false);
    }
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
    <>
      {/* Keep the focus target and live count available to assistive tech and
          regression checks without printing a second small line on the page. */}
      <div className="sr-only">
        <h1 ref={headingRef} id="trips-title" tabIndex={-1} className="sr-only">我的旅行</h1>
        <p className={styles.collectionCount} data-testid="trip-collection-count" aria-live="polite">共 <span>{String(visibleTrips.length).padStart(2, "0")}</span> 趟旅行，等待出发</p>
      </div>
    <section className={styles.collection} aria-labelledby="trips-title">
      <p className="sr-only" role="status">{announcement}</p>

      {visibleTrips.length === 0 ? (
        <div className={styles.emptyState}>
          <MapPinned aria-hidden="true" size={30} />
          <h2>还没有保存的旅行</h2>
          <p>从一句向往开始，让 AI 为你排好下一趟旅程。</p>
          <Link href="/#trip-input" className={styles.newTrip}>开始创建旅行<ArrowRight aria-hidden="true" size={15} /></Link>
        </div>
      ) : (
        <>
        <div className={styles.collectionToolbar}>
          <button
            type="button"
            className={styles.cleanupButton}
            disabled={isCleaning}
            onClick={() => { setError(null); setIsCleanupOpen(true); }}
          >
            <BrushCleaning aria-hidden="true" size={14} />清理重复与空白草稿
          </button>
        </div>
        <ul className={styles.tripGrid}>
          {visibleTrips.map((trip, index) => {
            // Resolved once per card: the same landscape drives both the image
            // and its object-position.
            const cover = coverPhotoForDestination(trip.destination, trip.originalQuote);
            return (
            <li key={trip.id}>
              <article className={styles.tripCard} data-trip-id={trip.id}>
                <Link href={`/trips/${trip.id}`} className={styles.cardLink}>
                  {/* Row 1: the destination's own photograph, exactly as the home
                      page's sample cards open. The frosted pills sit on the top
                      edge and the three-stop preview axis sits on the bottom
                      edge, both inside the same 136px band. */}
                  <div className={styles.cardPhoto}>
                    <Image fill sizes="(max-width: 680px) 100vw, (max-width: 1000px) 50vw, 400px" src={cover.src} alt="" className={styles.cardPhotoImage} style={{ objectPosition: cover.position }} />
                    <div className={styles.cardTopline}>
                      <span className={styles.destinationLine}>
                        <span className={styles.folio}>JOURNEY {String(index + 1).padStart(2, "0")}</span>
                        {trip.stops.length >= 3 ? <><span aria-hidden="true">·</span><span className={styles.destinationName}>{trip.destination}</span></> : null}
                      </span>
                      <span className={styles.cardPills}>
                        {trip.days ? <span className={styles.dayPill}>{trip.days} 天</span> : null}
                        <span className={`${styles.status} ${trip.isReady ? styles.statusReady : ""}`}>{trip.status}</span>
                      </span>
                    </div>
                    {trip.stops.length >= 3 ? (
                      <ol className={styles.miniTimeline} aria-label={`${trip.destination}路线预览，前 ${trip.stops.length} 站`}>
                        {trip.stops.map((stop, stopIndex) => (
                          <li key={stop}>
                            <span className={styles.previewStop}>{stop}</span>
                            <span className={styles.previewDot} aria-hidden="true" />
                            <span className={styles.previewIndex}>{String(stopIndex + 1).padStart(2, "0")}</span>
                          </li>
                        ))}
                      </ol>
                    ) : <p className={styles.cardPhotoDestination}>{trip.destination}</p>}
                  </div>
                  <div className={styles.cardBody}>
                    <h2 className={styles.cardTitle}>{trip.tripTitle || trip.title}</h2>
                    {trip.originalQuote !== trip.title ? <blockquote className={styles.cardDescription} title={trip.originalQuote} aria-label="出发灵感">“{trip.originalQuote}”</blockquote> : null}
                  </div>
                </Link>
                <div className={styles.cardBottom}>
                  <div className={styles.cardBottomMeta}>
                    <span className={styles.tripFacts}><CalendarDays aria-hidden="true" size={13} />{trip.dates}</span>
                    <button type="button" className={styles.deleteButton} aria-label={`删除旅行：${trip.title}`} onClick={() => { setError(null); setDeletingTrip(trip); }}><Trash2 aria-hidden="true" size={13} />删除</button>
                  </div>
                  <Link href={`/trips/${trip.id}`} className={styles.openLink}>打开继续<ArrowUpRight aria-hidden="true" size={16} /></Link>
                </div>
              </article>
            </li>
            );
          })}
        </ul>
        </>
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

      {isCleanupOpen ? (
        <dialog
          ref={cleanupDialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cleanup-duplicate-trips-title"
          aria-describedby="cleanup-duplicate-trips-description"
          className={styles.deleteDialog}
          onCancel={(event) => { event.preventDefault(); dismissCleanup(); }}
        >
          <div className={styles.dialogHeading}>
            <h2 id="cleanup-duplicate-trips-title">清理重复与空白草稿？</h2>
            <button type="button" className={styles.dialogClose} aria-label="关闭清理确认" disabled={isCleaning} onClick={dismissCleanup}><X aria-hidden="true" size={18} /></button>
          </div>
          <p id="cleanup-duplicate-trips-description">同名或同原话的旅行会保留最新且已生成计划的一份；未生成计划的空白草稿会一并删除。此操作无法恢复。</p>
          {error ? <p role="alert" className={styles.deleteError}>{error}</p> : null}
          <div className={styles.dialogActions}>
            <button ref={cleanupCancelButtonRef} type="button" className={styles.cancelButton} disabled={isCleaning} onClick={dismissCleanup}>保留全部</button>
            <button type="button" className={styles.confirmDeleteButton} disabled={isCleaning} onClick={confirmCleanup}><Trash2 aria-hidden="true" size={14} />{isCleaning ? "正在清理…" : "确认清理"}</button>
          </div>
        </dialog>
      ) : null}
    </section>
    </>
  );
}
