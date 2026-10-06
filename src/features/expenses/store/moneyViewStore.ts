import { create } from "zustand";
import { useTripsStore } from "@/features/trips/store/tripsStore";

export const OVERVIEW = "overview";

interface MoneyViewState {
  selected: string | null;
  /** The active trip when the pick was made; a different active trip brings back the default view. */
  pickedWithTripId: string | null;
  /** Money was used this session (scrolled, opened something, added); see `useLandingTab`. */
  used: boolean;
  select: (id: string | null) => void;
  markUsed: () => void;
  resetUsed: () => void;
}

export const useMoneyViewStore = create<MoneyViewState>()((set) => ({
  selected: null,
  pickedWithTripId: null,
  used: false,
  select: (selected) => set({ selected, pickedWithTripId: useTripsStore.getState().activeTripId, used: true }),
  markUsed: () => set({ used: true }),
  resetUsed: () => set({ used: false }),
}));

/** What the Money tab shows: a trip or group id, OVERVIEW, or null for the default (the active trip, else the overview). */
export function useMoneySelection(): string | null {
  const selected = useMoneyViewStore((state) => state.selected);
  const pickedWithTripId = useMoneyViewStore((state) => state.pickedWithTripId);
  const activeTripId = useTripsStore((state) => state.activeTripId);
  return pickedWithTripId === activeTripId ? selected : null;
}
