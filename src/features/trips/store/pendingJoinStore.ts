import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface PendingJoinState {
  code: string | null;
  setCode: (code: string | null) => void;
}

/**
 * An invite link opened before the app could show it (signed out, onboarding, cold start). Persisted
 * so it survives sign-in; the tabs layout opens the join screen once the user is in the app.
 */
export const usePendingJoinStore = create<PendingJoinState>()(
  persist(
    (set) => ({
      code: null,
      setCode: (code) => set({ code }),
    }),
    { name: "pending-join", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);

/** Extracts the code from `/join/<code>` (deep link) paths. */
export function inviteCodeFromPath(path: string): string | null {
  const match = /(?:^|\/)join\/([A-Za-z0-9]{4,16})\/?(?:\?|$)/.exec(path);
  return match ? match[1].toUpperCase() : null;
}
