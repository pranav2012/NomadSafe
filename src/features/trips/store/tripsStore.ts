import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";

export type TripMode = "solo" | "group";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Trip {
  id: string;
  name: string;
  destinations: string[];
  destinationCoordinates?: LatLng[];
  startDate: string;
  endDate: string;
  mode: TripMode;
  budget: number;
  currency: string;
  companions: string[];
  createdAt: string;
}

export interface CreateTripInput {
  name: string;
  destinations: string[];
  destinationCoordinates?: LatLng[];
  startDate: string;
  endDate: string;
  mode: TripMode;
  budget: number;
  currency: string;
  companions: string[];
}

export type UpdateTripInput = Partial<Omit<Trip, "id" | "createdAt">>;

interface TripsState {
  trips: Trip[];
  activeTripId: string | null;
  createTrip: (input: CreateTripInput) => Trip;
  updateTrip: (tripId: string, input: UpdateTripInput) => Trip | null;
  deleteTrip: (tripId: string) => void;
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
      updateTrip: (tripId, input) => {
        let updated: Trip | null = null;
        set((state) => {
          const trips = state.trips.map((trip) => {
            if (trip.id !== tripId) return trip;
            updated = { ...trip, ...input };
            return updated;
          });
          return { trips };
        });
        return updated;
      },
      deleteTrip: (tripId) =>
        set((state) => ({
          trips: state.trips.filter((trip) => trip.id !== tripId),
          activeTripId:
            state.activeTripId === tripId ? null : state.activeTripId,
        })),
      setActiveTrip: (tripId) => set({ activeTripId: tripId }),
      clearActiveTrip: () => set({ activeTripId: null }),
    }),
    {
      name: "trips-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 3,
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
