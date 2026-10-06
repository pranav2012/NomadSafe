import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

export interface Embassy {
  name: string;
  phone: string | null;
  address: string | null;
  mapsUrl: string | null;
}

export interface DriverAddress {
  name: string;
  address: string;
  mapsUrl: string | null;
}

interface TravelInfoState {
  /** By "<home>:<destination>" country codes; null when Google found no embassy. Kept for offline use. */
  embassies: Record<string, { embassy: Embassy | null; fetchedAt: number }>;
  /** A stay's name and address in the local language, by itinerary event id. */
  addresses: Record<string, DriverAddress>;
  setEmbassy: (key: string, embassy: Embassy | null) => void;
  setAddress: (eventId: string, address: DriverAddress) => void;
  reset: () => void;
}

/** Looked-up travel details the pass's back shows, cached so they work without a connection. */
export const useTravelInfoStore = create<TravelInfoState>()(
  persist(
    (set) => ({
      embassies: {},
      addresses: {},
      setEmbassy: (key, embassy) => set((state) => ({ embassies: { ...state.embassies, [key]: { embassy, fetchedAt: Date.now() } } })),
      setAddress: (eventId, address) => set((state) => ({ addresses: { ...state.addresses, [eventId]: address } })),
      reset: () => set({ embassies: {}, addresses: {} }),
    }),
    { name: "travel-info-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
