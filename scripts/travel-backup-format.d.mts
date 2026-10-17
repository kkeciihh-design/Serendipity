import type { Trip, TripRequest, PlanVersion, EvidenceFact, ChecklistState, ExecutionState, AdvisoryState } from "@prisma/client";
type Stored<T> = { [P in keyof T]: T[P] extends Date ? number | string : T[P] extends Date | null ? number | string | null : T[P] extends boolean ? 0 | 1 : T[P] };
export type TravelBackup = { format: "serendipity-travel"; version: 1; createdAt: string; tables: {
  Trip: Stored<Trip>[]; TripRequest: Stored<TripRequest>[]; PlanVersion: Stored<PlanVersion>[]; EvidenceFact: Stored<EvidenceFact>[];
  ChecklistState: Stored<ChecklistState>[]; ExecutionState: Stored<ExecutionState>[]; AdvisoryState: Stored<AdvisoryState>[];
} };
export const MAX_BACKUP_BYTES: number;
export const TRAVEL_TABLES: (keyof TravelBackup["tables"])[];
export const tableColumns: Record<string, string[]>;
export function parseTravelBackup(raw: unknown): TravelBackup;
export function backupHash(backup: TravelBackup): string;
export function fileHash(value: string | Uint8Array): string;
export function backupSummary(backup: TravelBackup): { trips: number; plans: number; events: number; titles: string[]; createdAt: string };
