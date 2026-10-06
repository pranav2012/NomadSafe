import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface MustDoState {
  /** Must-do keys the user waved away, per trip; they never come back for that trip. */
  dismissed: Record<string, string[]>;
  dismiss: (tripId: string, key: string) => void;
  reset: () => void;
}

export const useMustDoStore = create<MustDoState>()(
  persist(
    (set) => ({
      dismissed: {},
      dismiss: (tripId, key) =>
        set((state) => ({ dismissed: { ...state.dismissed, [tripId]: [...new Set([...(state.dismissed[tripId] ?? []), key])] } })),
      reset: () => set({ dismissed: {} }),
    }),
    { name: "must-do-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
