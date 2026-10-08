import { create } from "zustand";

export type PocketSheetStep = "main" | "count" | "leftover";

interface ForexSheetState {
  pocketId: string | null;
  step: PocketSheetStep;
  /** Trip whose "Add forex" sheet was asked for from the Money ⋯ menu. */
  addingTripId: string | null;
  open: (pocketId: string, step?: PocketSheetStep) => void;
  close: () => void;
  startAdding: (tripId: string) => void;
  stopAdding: () => void;
}

/** Which forex sheet is open, so the activity list and the Money ⋯ menu can open them. */
export const useForexSheetStore = create<ForexSheetState>((set) => ({
  pocketId: null,
  step: "main",
  addingTripId: null,
  open: (pocketId, step = "main") => set({ pocketId, step }),
  close: () => set({ pocketId: null }),
  startAdding: (tripId) => set({ addingTripId: tripId }),
  stopAdding: () => set({ addingTripId: null }),
}));
