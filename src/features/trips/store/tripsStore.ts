import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
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

/** What every money group has: people, a currency and optional sharing. Trips add travel details. */
export interface GroupBase {
  id: string;
  name: string;
  /** 0 when there is no budget; check with `hasTripBudget`. */
  budget: number;
  currency: string;
  companions: string[];
  createdAt: string;
  shared?: SharedTripInfo;
}

/** A money group without travel details (flatmates, office lunches). Never the active trip. */
export interface Group extends GroupBase {
  kind: "group";
  emoji?: string;
}

export interface Trip extends GroupBase {
  kind?: "trip";
  destinations: string[];
  /** Index-aligned with `destinations`; `null` where geocoding failed. */
  destinationCoordinates?: (LatLng | null)[];
  startDate: string;
  endDate: string;
  mode: TripMode;
}

/** Anything expenses can belong to: a trip or a group. */
export type MoneyGroup = Trip | Group;

export function isTrip(group: MoneyGroup): group is Trip {
  return group.kind !== "group";
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

export interface CreateGroupInput {
  name: string;
  emoji?: string;
  currency: string;
  companions: string[];
}

export type UpdateGroupInput = Partial<Omit<Group, "id" | "createdAt" | "kind">>;

interface TripsState {
  trips: Trip[];
  groups: Group[];
  activeTripId: string | null;
  createTrip: (input: CreateTripInput) => Trip;
  updateTrip: (tripId: string, input: UpdateTripInput) => Trip | null;
  deleteTrip: (tripId: string) => void;
  createGroup: (input: CreateGroupInput) => Group;
  updateGroup: (groupId: string, input: UpdateGroupInput) => Group | null;
  deleteGroup: (groupId: string) => void;
  setActiveTrip: (tripId: string) => void;
  clearActiveTrip: () => void;
  reset: () => void;
}

/** The selected trip, or null. No implicit fallback: Home and Trips share this rule. */
export function selectActiveTrip(state: Pick<TripsState, "trips" | "activeTripId">): Trip | null {
  return state.trips.find((trip) => trip.id === state.activeTripId) ?? null;
}

let moneyGroupsCache: { trips: Trip[]; groups: Group[]; all: MoneyGroup[] } | null = null;

/** Trips and groups together (stable reference while neither list changes). */
export function selectMoneyGroups(state: Pick<TripsState, "trips" | "groups">): MoneyGroup[] {
  const cache = moneyGroupsCache;
  if (cache && cache.trips === state.trips && cache.groups === state.groups) return cache.all;
  const all: MoneyGroup[] = [...state.trips, ...state.groups];
  moneyGroupsCache = { trips: state.trips, groups: state.groups, all };
  return all;
}

export function findMoneyGroup(state: Pick<TripsState, "trips" | "groups">, id: string | null | undefined): MoneyGroup | null {
  if (!id) return null;
  return state.trips.find((trip) => trip.id === id) ?? state.groups.find((group) => group.id === id) ?? null;
}

/**
 * Replaces trips and groups from one combined list (sync code works on both), keeping the active
 * trip when it still exists and otherwise picking the default one.
 */
export function setMoneyGroups(list: MoneyGroup[]) {
  const trips = list.filter(isTrip);
  const groups = list.filter((item): item is Group => !isTrip(item));
  const { activeTripId } = useTripsStore.getState();
  useTripsStore.setState({
    trips,
    groups,
    activeTripId: trips.some((trip) => trip.id === activeTripId) ? activeTripId : pickDefaultActiveTripId(trips),
  });
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

export function hasTripBudget(trip: Pick<GroupBase, "budget">): boolean {
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
      groups: [],
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
      createGroup: (input) => {
        const group: Group = {
          ...input,
          kind: "group",
          budget: 0,
          id: `${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ groups: [group, ...state.groups] }));
        return group;
      },
      updateGroup: (groupId, input) => {
        let updated: Group | null = null;
        set((state) => ({
          groups: state.groups.map((group) => {
            if (group.id !== groupId) return group;
            updated = { ...group, ...input };
            return updated;
          }),
        }));
        return updated;
      },
      deleteGroup: (groupId) => set((state) => ({ groups: state.groups.filter((group) => group.id !== groupId) })),
      // Only trips can be active; a group id is ignored.
      setActiveTrip: (tripId) => set((state) => (state.trips.some((trip) => trip.id === tripId) ? { activeTripId: tripId } : {})),
      clearActiveTrip: () => set({ activeTripId: null }),
      reset: () => set({ trips: [], groups: [], activeTripId: null }),
    }),
    {
      name: "trips-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 5,
      migrate: (persistedState, version) => {
        const state = persistedState as Partial<TripsState> | undefined;
        if (!state?.trips) return persistedState;
        // v5 added groups next to trips.
        if (version >= 4) return { ...state, groups: state.groups ?? [] };

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

        return { ...state, trips, groups: [], activeTripId };
      },
    },
  ),
);
