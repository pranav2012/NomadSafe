import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

// Android keeps the launching link, so a JS reload (dev, OTA update) hands the same file over again.
const HANDLED_FOR_MS = 30 * 60_000;
const MAX_HANDLED = 20;

interface IncomingTicketState {
  /** A file another app opened with NomadSafe, waiting for the user to pick its item. */
  uri: string | null;
  /** Recently handled links and when, so a relaunch with the same link doesn't ask again. */
  handled: Record<string, number>;
  set: (uri: string | null) => void;
  markHandled: (uri: string) => void;
  wasHandled: (uri: string) => boolean;
}

export const useIncomingTicketStore = create<IncomingTicketState>()(
  persist(
    (set, get) => ({
      uri: null,
      handled: {},
      set: (uri) => set({ uri }),
      markHandled: (uri) =>
        set((state) => ({ handled: Object.fromEntries([...Object.entries(state.handled), [uri, Date.now()]].slice(-MAX_HANDLED)) })),
      wasHandled: (uri) => {
        const at = get().handled[uri];
        return at !== undefined && Date.now() - at < HANDLED_FOR_MS;
      },
    }),
    {
      name: "incoming-ticket-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: (state) => ({ handled: state.handled }),
    },
  ),
);

/** "Open with NomadSafe" hands over a content:// (Android) or file:// (iOS) link instead of a deep link. */
export const isIncomingFileLink = (path: string) => /^(content|file):\/\//i.test(path);
