import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

export interface Ticket {
  id: string;
  eventId: string;
  name: string;
  kind: "pdf" | "image";
  /** Local file in the app's private documents folder; tickets never leave the phone. */
  uri: string;
  source: "gmail" | "file" | "photo";
  /** Gmail imports: `<message id>:<file name>`, so a rescan doesn't save the same file twice. */
  sourceKey?: string;
  addedAt: string;
}

interface TicketsState {
  tickets: Ticket[];
  add: (ticket: Ticket) => void;
  remove: (ids: string[]) => void;
  reset: () => void;
}

/** Tickets and booking files attached to itinerary items, kept on this phone only (not backed up or shared). */
export const useTicketsStore = create<TicketsState>()(
  persist(
    (set) => ({
      tickets: [],
      add: (ticket) => set((state) => ({ tickets: [...state.tickets, ticket] })),
      remove: (ids) => set((state) => ({ tickets: state.tickets.filter((ticket) => !ids.includes(ticket.id)) })),
      reset: () => set({ tickets: [] }),
    }),
    { name: "tickets-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
