import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface PendingJoinState {
  code: string | null;
  /** Set when the code survived an install (Play referrer or iOS clipboard). */
  deferred: boolean;
  setCode: (code: string | null, deferred?: boolean) => void;
}

/**
 * An invite link opened before the app could show it (signed out, onboarding, cold start). Persisted
 * so it survives sign-in; the tabs layout opens the join screen once the user is in the app.
 */
export const usePendingJoinStore = create<PendingJoinState>()(
  persist(
    (set) => ({
      code: null,
      deferred: false,
      setCode: (code, deferred = false) => set({ code, deferred }),
    }),
    { name: "pending-join", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
