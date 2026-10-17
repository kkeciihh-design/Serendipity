import type { TravelBackup, backupSummary } from "./travel-backup-format.mjs";
export class RestoreGuardError extends Error { code: string; status: number; constructor(code?: string); }
export type InstanceState = { id: string; dataGeneration: string; activeRestoreId: string | null };
export type RestoreHistory = { id: string; phase: string; source: string; message: string; startedAt: string; finishedAt: string | null };
export function assertGeneration(state: InstanceState, expected: string | null | undefined): void;
export function readInstanceState(databasePath: string): InstanceState & { history: RestoreHistory[] };
export function readTravelBackup(databasePath: string): TravelBackup;
export function resumeInterruptedRestore(databasePath: string): InstanceState | null;
export type RestoreConfirmation = { backupHash: string; currentHash: string; dataGeneration: string; source?: "web" | "technical" };
export function previewRestore(databasePath: string, raw: unknown): RestoreConfirmation & { incoming: ReturnType<typeof backupSummary>; current: ReturnType<typeof backupSummary> };
export function restoreTravelBackup(databasePath: string, raw: unknown, confirmation: RestoreConfirmation, hooks?: {
  afterBarrier?: () => void | Promise<void>; beforeSafetyWrite?: () => void | Promise<void>; afterSafety?: () => void | Promise<void>;
  afterReplace?: () => void; beforeProtection?: () => void | Promise<void>;
}): Promise<ReturnType<typeof backupSummary> & { id: string; phase: string }>;
