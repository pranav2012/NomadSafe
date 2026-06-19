import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";

export type TripMode = "solo" | "group";

export interface Trip {
  id: string;
  name: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  mode: TripMode;
  budget: number;
  currency: string;
  companions: string[];
  createdAt: string;
}

interface CreateTripInput {
  name: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  mode: TripMode;
  budget: number;
  currency: string;
  companions: string[];
}

interface TripsState {
  trips: Trip[];
  activeTripId: string | null;
  createTrip: (input: CreateTripInput) => Trip;
  setActiveTrip: (tripId: string) => void;
  clearActiveTrip: () => void;
}

export const useTripsStore = create<TripsState>()(
  persist(
    (set) => ({
      trips: [],
      activeTripId: null,
      createTrip: (input) => {
        const now = new Date().toISOString();
        const trip: Trip = {
          ...input,
          id: `${Date.now()}`,
          createdAt: now,
        };

        set((state) => ({
          trips: [trip, ...state.trips],
          activeTripId: trip.id,
        }));

        return trip;
      },
      setActiveTrip: (tripId) => set({ activeTripId: tripId }),
      clearActiveTrip: () => set({ activeTripId: null }),
    }),
    {
      name: "trips-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<TripsState> | undefined;
        if (!state?.trips) return persistedState;

        return {
          ...state,
          trips: state.trips.map((trip) => {
            const legacyTrip = trip as Trip & { destination?: string };
            const { destination: legacyDestination, ...rest } = legacyTrip;
            return {
              ...rest,
              destinations:
                legacyTrip.destinations ??
                (legacyDestination ? [legacyDestination] : []),
            };
          }),
        };
      },
    },
  ),
);
