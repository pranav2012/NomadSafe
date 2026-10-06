import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface KeepGroupState {
  /** Ended trips whose "Keep as a group" card was used or dismissed. */
  handled: string[];
  markHandled: (tripId: string) => void;
  reset: () => void;
}

export const useKeepGroupStore = create<KeepGroupState>()(
  persist(
    (set) => ({
      handled: [],
      markHandled: (tripId) => set((state) => (state.handled.includes(tripId) ? state : { handled: [...state.handled, tripId] })),
      reset: () => set({ handled: [] }),
    }),
    { name: "keep-group-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
