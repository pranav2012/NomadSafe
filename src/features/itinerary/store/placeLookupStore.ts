import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface PlaceLookupState {
  /** Per item: the search last sent for it, and whether it found a place. A new search runs only when the query changes. */
  tried: Record<string, { query: string; found: boolean }>;
  record: (results: { eventId: string; query: string; found: boolean }[]) => void;
  reset: () => void;
}

export const usePlaceLookupStore = create<PlaceLookupState>()(
  persist(
    (set) => ({
      tried: {},
      record: (results) =>
        set((state) => ({
          tried: { ...state.tried, ...Object.fromEntries(results.map(({ eventId, query, found }) => [eventId, { query, found }])) },
        })),
      reset: () => set({ tried: {} }),
    }),
    { name: "place-lookup-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
