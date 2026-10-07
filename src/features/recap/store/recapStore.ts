import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { pickDefaultActiveTripId, useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { addDays, fromDateKey, getTripStatus } from "@/features/trips/utils/dates";
import type { DailySteps } from "../utils/replayFacts";

export interface TripWalking {
  steps: number;
  km: number;
  estimated: boolean;
  /** Steps per local day; missing on totals read by older versions. */
  daily?: DailySteps[];
  at: string;
}

interface RecapState {
  /** Trip id → when its recap was finished; Home stops offering the recap after that. */
  finished: Record<string, string>;
  /** True while the replay screen is up, so Home drops its globe (one full-size Skia canvas at a time). */
  replayOpen: boolean;
  /** The user allowed reading steps from Health Connect / Apple Health. */
  healthLinked: boolean;
  /** Steps and walking distance per trip, read once the trip has ended (stays on this phone). */
  walking: Record<string, TripWalking>;
  /** Trips whose "make it yours" step was done or skipped, so the replay opens straight away. */
  prepped: Record<string, true>;
  /** The replay's music is off. */
  muted: boolean;
  markFinished: (tripId: string) => void;
  setReplayOpen: (open: boolean) => void;
  setHealthLinked: (linked: boolean) => void;
  setWalking: (tripId: string, totals: Omit<TripWalking, "at"> | null) => void;
  markPrepped: (tripId: string) => void;
  setMuted: (muted: boolean) => void;
  /** Forgets a deleted trip's steps and replay state. */
  clearTrip: (tripId: string) => void;
  reset: () => void;
}

export const useRecapStore = create<RecapState>()(
  persist(
    (set) => ({
      finished: {},
      replayOpen: false,
      healthLinked: false,
      walking: {},
      prepped: {},
      muted: false,
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
      markPrepped: (tripId) => set((state) => ({ prepped: { ...state.prepped, [tripId]: true } })),
      setMuted: (muted) => set({ muted }),
      clearTrip: (tripId) =>
        set((state) => {
          const walking = { ...state.walking };
          const prepped = { ...state.prepped };
          delete walking[tripId];
          delete prepped[tripId];
          return { walking, prepped };
        }),
      reset: () => set({ finished: {}, replayOpen: false, healthLinked: false, walking: {}, prepped: {}, muted: false }),
    }),
    {
      name: "trip-recap",
      storage: createJSONStorage(() => mmkvStateStorage),
      // v1 added per-day steps, the replay's prep step and mute.
      version: 1,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<RecapState>;
        return { ...state, walking: state.walking ?? {}, prepped: state.prepped ?? {}, muted: state.muted ?? false } as RecapState;
      },
      partialize: (state) => ({ finished: state.finished, healthLinked: state.healthLinked, walking: state.walking, prepped: state.prepped, muted: state.muted }),
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
