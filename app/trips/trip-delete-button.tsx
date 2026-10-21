"use client";
import { businessFetch } from "@/lib/business-fetch";

import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./trips.module.css";

export function TripDeleteButton({
  tripId,
  tripTitle,
}: {
  tripId: string;
  tripTitle: string;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
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
    };
  }, [isOpen]);

  const dismissDelete = () => {
    if (pendingRef.current) return;
    setIsOpen(false);
    setError(null);
  };

  const confirmDelete = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      const response = await businessFetch(`/api/trips/${tripId}`, {
        method: "DELETE",
      });
      // A trip removed in another tab is just as gone as ours.
      if (!response.ok && response.status !== 404) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          payload?.error ?? "删除失败，这趟旅行仍然保留，请稍后重试。",
        );
      }
      setIsOpen(false);
      router.replace("/trips");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "删除失败，这趟旅行仍然保留，请稍后重试。",
      );
    } finally {
      pendingRef.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`${styles.detailDeleteButton} backdrop-blur-md`}
        aria-label={`删除这趟旅行：${tripTitle}`}
        data-testid="trip-detail-delete"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" size={12} />
        删除这趟旅行
      </button>
      {isOpen ? (
        <dialog
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-detail-trip-title"
          aria-describedby="delete-detail-trip-description"
          className={styles.deleteDialog}
          onCancel={(event) => {
            event.preventDefault();
            dismissDelete();
          }}
        >
          <div className={styles.dialogHeading}>
            <h2 id="delete-detail-trip-title">删除这趟旅行？</h2>
            <button
              type="button"
              className={styles.dialogClose}
              aria-label="关闭删除确认"
              disabled={isDeleting}
              onClick={dismissDelete}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </div>
          <p id="delete-detail-trip-description">
            「{tripTitle}」及其行程版本将被删除，此操作无法恢复。
          </p>
          {error ? (
            <p role="alert" className={styles.deleteError}>
              {error}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <button
              ref={cancelButtonRef}
              type="button"
              className={styles.cancelButton}
              disabled={isDeleting}
              onClick={dismissDelete}
            >
              保留旅行
            </button>
            <button
              type="button"
              className={styles.confirmDeleteButton}
              disabled={isDeleting}
              onClick={confirmDelete}
            >
              <Trash2 aria-hidden="true" size={14} />
              {isDeleting ? "正在删除…" : "确认删除"}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
