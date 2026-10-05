import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { pickDefaultActiveTripId, useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { addDays, fromDateKey, getTripStatus } from "@/features/trips/utils/dates";

interface RecapState {
  /** Trip id → when its recap was finished; Home stops offering the recap after that. */
  finished: Record<string, string>;
  /** True while the replay screen is up, so Home drops its globe (one full-size Skia canvas at a time). */
  replayOpen: boolean;
  /** The user allowed reading steps from Health Connect / Apple Health. */
  healthLinked: boolean;
  /** Steps and walking distance per trip, read once the trip has ended (stays on this phone). */
  walking: Record<string, { steps: number; km: number; estimated: boolean; at: string }>;
  markFinished: (tripId: string) => void;
  setReplayOpen: (open: boolean) => void;
  setHealthLinked: (linked: boolean) => void;
  setWalking: (tripId: string, totals: { steps: number; km: number; estimated: boolean } | null) => void;
  reset: () => void;
}

export const useRecapStore = create<RecapState>()(
  persist(
    (set) => ({
      finished: {},
      replayOpen: false,
      healthLinked: false,
      walking: {},
      markFinished: (tripId) => set((state) => ({ finished: { ...state.finished, [tripId]: new Date().toISOString() } })),
      setReplayOpen: (replayOpen) => set({ replayOpen }),
      setHealthLinked: (healthLinked) => set({ healthLinked }),
      setWalking: (tripId, totals) =>
        set((state) => {
          const walking = { ...state.walking };
          if (totals) walking[tripId] = { ...totals, at: new Date().toISOString() };
          else delete walking[tripId];
          return { walking };
        }),
      reset: () => set({ finished: {}, replayOpen: false, healthLinked: false, walking: {} }),
    }),
    {
      name: "trip-recap",
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: (state) => ({ finished: state.finished, healthLinked: state.healthLinked, walking: state.walking }),
    },
  ),
);

/** True once the recap was finished after the trip ended; a trip extended past that point gets a new recap. */
export function isRecapFinished(trip: Pick<Trip, "id" | "endDate">, finished: Record<string, string>): boolean {
  const at = finished[trip.id];
  return at !== undefined && new Date(at).getTime() >= addDays(fromDateKey(trip.endDate), 1).getTime();
}

/** Marks an ended trip's recap done and, if it was the trip on Home, moves Home to the running or next trip. */
export function finishRecap(tripId: string) {
  const trips = useTripsStore.getState();
  const trip = trips.trips.find((item) => item.id === tripId);
  if (!trip || getTripStatus(trip) !== "complete") return;
  useRecapStore.getState().markFinished(tripId);
  if (trips.activeTripId !== tripId) return;
  const next = pickDefaultActiveTripId(trips.trips);
  if (next) trips.setActiveTrip(next);
  else trips.clearActiveTrip();
}
