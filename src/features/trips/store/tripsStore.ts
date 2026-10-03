import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/stores/storage";
import { getOfflineCoordinates } from "@/features/trips/services/geocoding";
import { fromDateKey, getTripStatus } from "@/features/trips/utils/dates";

export type TripMode = "solo" | "group";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface TripMember {
  memberId: string;
  name: string;
  role: "owner" | "member";
  status: "active" | "left" | "removed";
  /** False for name-only companions nobody has claimed yet. */
  linked: boolean;
}

/** Present when the trip is shared through an invite link; kept in sync with the server. */
export interface SharedTripInfo {
  tripId: string;
  /** Empty until the server's member list first arrives after sharing. */
  myMemberId: string;
  role: "owner" | "member";
  inviteCode: string;
  archived: boolean;
  muted: boolean;
  members: TripMember[];
}

export interface Trip {
  id: string;
  name: string;
  destinations: string[];
  /** Index-aligned with `destinations`; `null` where geocoding failed. */
  destinationCoordinates?: (LatLng | null)[];
  startDate: string;
  endDate: string;
  mode: TripMode;
  /** 0 when the trip has no budget; check with `hasTripBudget`. */
  budget: number;
  currency: string;
  companions: string[];
  createdAt: string;
  shared?: SharedTripInfo;
}

export interface CreateTripInput {
  name: string;
  destinations: string[];
  destinationCoordinates?: (LatLng | null)[];
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
  reset: () => void;
}

/** The selected trip, or null. No implicit fallback: Home and Trips share this rule. */
export function selectActiveTrip(state: Pick<TripsState, "trips" | "activeTripId">): Trip | null {
  return state.trips.find((trip) => trip.id === state.activeTripId) ?? null;
}

/** Earliest-starting running trip, else the soonest upcoming one, else null. */
export function pickDefaultActiveTripId(trips: Trip[]): string | null {
  const byStart = trips.filter((trip) => !trip.shared?.archived).sort(
    (a, b) => fromDateKey(a.startDate).getTime() - fromDateKey(b.startDate).getTime(),
  );
  return (
    byStart.find((trip) => getTripStatus(trip) === "active")?.id ??
    byStart.find((trip) => getTripStatus(trip) === "upcoming")?.id ??
    null
  );
}

export function hasTripBudget(trip: Pick<Trip, "budget">): boolean {
  return Number.isFinite(trip.budget) && trip.budget > 0;
}

/** Coordinates aligned to `trip.destinations`; legacy misaligned data falls back to the offline table. */
export function getDestinationCoordinates(trip: Trip): (LatLng | null)[] {
  const stored = trip.destinationCoordinates;
  if (stored && stored.length === trip.destinations.length) {
    return stored.map((coord) => coord ?? null);
  }
  return trip.destinations.map((destination) => getOfflineCoordinates(destination));
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
        set((state) => {
          const trips = state.trips.filter((trip) => trip.id !== tripId);
          return {
            trips,
            activeTripId:
              state.activeTripId === tripId ? pickDefaultActiveTripId(trips) : state.activeTripId,
          };
        }),
      setActiveTrip: (tripId) => set({ activeTripId: tripId }),
      clearActiveTrip: () => set({ activeTripId: null }),
      reset: () => set({ trips: [], activeTripId: null }),
    }),
    {
      name: "trips-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 4,
      migrate: (persistedState) => {
        const state = persistedState as Partial<TripsState> | undefined;
        if (!state?.trips) return persistedState;

        const trips = state.trips.map((trip) => {
          const legacyTrip = trip as Trip & { destination?: string };
          const { destination: legacyDestination, ...rest } = legacyTrip;
          const migrated: Trip = {
            ...rest,
            destinations:
              legacyTrip.destinations ??
              (legacyDestination ? [legacyDestination] : []),
          };
          // v3 dropped failed geocodes, so shorter arrays can't be trusted by index.
          return { ...migrated, destinationCoordinates: getDestinationCoordinates(migrated) };
        });
        // v3 screens silently fell back to trips[0]; persist that choice explicitly.
        const activeTripId = trips.some((trip) => trip.id === state.activeTripId)
          ? (state.activeTripId ?? null)
          : (pickDefaultActiveTripId(trips) ?? trips[0]?.id ?? null);

        return { ...state, trips, activeTripId };
      },
    },
  ),
);
