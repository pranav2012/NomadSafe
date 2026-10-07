import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

/** Travel from before NomadSafe, added by hand. Backed up with the trips (kind "passport"). */
export interface PastTravel {
  id: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** State key (see `countryRegions`) when the user picked a city in it. */
  region: string | null;
  /** The label the user picked, e.g. "Goa, India". */
  place: string | null;
  year: number;
  /** 1–12, or null when only the year is known. */
  month: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PastTravelInput = Pick<PastTravel, "country" | "region" | "place" | "year" | "month">;

interface PassportState {
  entries: PastTravel[];
  addEntry: (input: PastTravelInput) => PastTravel;
  removeEntry: (id: string) => void;
  reset: () => void;
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const usePassportStore = create<PassportState>()(
  persist(
    (set) => ({
      entries: [],
      addEntry: (input) => {
        const now = new Date().toISOString();
        const entry: PastTravel = { ...input, id: newId(), createdAt: now, updatedAt: now };
        set((state) => ({ entries: [entry, ...state.entries] }));
        return entry;
      },
      removeEntry: (id) => set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
      reset: () => set({ entries: [] }),
    }),
    { name: "passport", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
