import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface IncomingShareState {
  /** What another app shared: a link, or a caption with a link in it. */
  text: string | null;
  set: (text: string) => void;
  /** Hands the waiting text to "Save idea" and clears it. */
  take: () => string | null;
  clear: () => void;
}

// iOS can deliver the same link twice (launch URL and URL event); the second copy is ignored.
const REPEAT_MS = 5000;
let last: { text: string; at: number } | null = null;

/**
 * A link shared into the app (iOS Share Extension or Android share intent), held until the user is
 * signed in and in the app; the tabs layout then opens the save sheet. Persisted so it survives sign-in.
 */
export const useIncomingShareStore = create<IncomingShareState>()(
  persist(
    (set, get) => ({
      text: null,
      set: (text) => {
        const value = text.slice(0, 2000);
        if (last && last.text === value && Date.now() - last.at < REPEAT_MS) return;
        last = { text: value, at: Date.now() };
        set({ text: value });
      },
      take: () => {
        const { text } = get();
        if (text !== null) set({ text: null });
        return text;
      },
      clear: () => set({ text: null }),
    }),
    { name: "incoming-share", storage: createJSONStorage(() => mmkvStateStorage), partialize: (state) => ({ text: state.text }) },
  ),
);
