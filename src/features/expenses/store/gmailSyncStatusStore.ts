import { create } from "zustand";
import type { ImportErrorCode } from "@/features/expenses/services/importErrors";

export interface GmailFetchProgress {
  phase: "listing" | "reading";
  done: number;
  total: number;
}

export type GmailSyncState = "idle" | "syncing" | "done" | "failed";

export interface TripGmailSyncStatus {
  state: GmailSyncState;
  progress: GmailFetchProgress | null;
  errorCode: ImportErrorCode | null;
  /** Spends added by syncs that the Money banner hasn't shown yet. */
  unseenExpenses: number;
}

const IDLE: TripGmailSyncStatus = { state: "idle", progress: null, errorCode: null, unseenExpenses: 0 };

/** In-memory Gmail sync status per trip, for loading, empty states and the Money banner. */
export const useGmailSyncStatus = create<{ byTrip: Record<string, TripGmailSyncStatus> }>()(() => ({ byTrip: {} }));

export function updateTripGmailSyncStatus(
  tripId: string,
  update: Partial<TripGmailSyncStatus> | ((current: TripGmailSyncStatus) => Partial<TripGmailSyncStatus>),
): void {
  useGmailSyncStatus.setState((state) => {
    const current = state.byTrip[tripId] ?? IDLE;
    const patch = typeof update === "function" ? update(current) : update;
    return { byTrip: { ...state.byTrip, [tripId]: { ...current, ...patch } } };
  });
}

export function useTripGmailSyncStatus(tripId: string | null | undefined): TripGmailSyncStatus {
  return useGmailSyncStatus((state) => (tripId ? state.byTrip[tripId] : undefined) ?? IDLE);
}

export function dismissGmailSyncBanner(tripId: string): void {
  updateTripGmailSyncStatus(tripId, { unseenExpenses: 0 });
}
