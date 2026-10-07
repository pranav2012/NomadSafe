import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface IncomingShareState {
  /** What another app shared: a link, or a caption with a link in it. */
  text: string | null;
  set: (text: string) => void;
  clear: () => void;
}

/**
 * A link shared into the app (iOS Share Extension or Android share intent), held until the user is
 * signed in and in the app; the tabs layout then opens the save sheet. Persisted so it survives sign-in.
 */
export const useIncomingShareStore = create<IncomingShareState>()(
  persist(
    (set) => ({
      text: null,
      set: (text) => set({ text: text.slice(0, 2000) }),
      clear: () => set({ text: null }),
    }),
    { name: "incoming-share", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
