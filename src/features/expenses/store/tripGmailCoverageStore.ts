import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import type { TripGmailCoverage } from "@/features/expenses/services/tripGmailCoverage";

interface TripGmailCoverageState {
  byTrip: Record<string, TripGmailCoverage>;
}

/** Per-trip record of which Gmail mail has already been scanned, so syncs only read new mail. */
export const useTripGmailCoverageStore = create<TripGmailCoverageState>()(
  persist(() => ({ byTrip: {} }), {
    name: "gmail-trip-coverage",
    storage: createJSONStorage(() => mmkvStateStorage),
    version: 1,
  }),
);

export function getTripGmailCoverage(tripId: string): TripGmailCoverage | undefined {
  return useTripGmailCoverageStore.getState().byTrip[tripId];
}

export function setTripGmailCoverage(tripId: string, coverage: TripGmailCoverage): void {
  useTripGmailCoverageStore.setState((state) => ({ byTrip: { ...state.byTrip, [tripId]: coverage } }));
}

export function clearTripGmailCoverage(tripId?: string): void {
  useTripGmailCoverageStore.setState((state) => {
    if (!tripId) return { byTrip: {} };
    const { [tripId]: _removed, ...rest } = state.byTrip;
    return { byTrip: rest };
  });
}
