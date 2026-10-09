import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { InviteLink } from "@/features/trips/utils/inviteLinks";

interface PendingJoinState {
  invite: InviteLink | null;
  /** Set when the invite survived an install (Play referrer or iOS clipboard). */
  deferred: boolean;
  setInvite: (invite: InviteLink | null, deferred?: boolean) => void;
}

/**
 * An invite link (trip/group or circle) opened before the app could show it (signed out,
 * onboarding, cold start). Persisted so it survives sign-in; the tabs layout opens the matching
 * join screen once the user is in the app.
 */
export const usePendingJoinStore = create<PendingJoinState>()(
  persist(
    (set) => ({
      invite: null,
      deferred: false,
      setInvite: (invite, deferred = false) => set({ invite, deferred }),
    }),
    {
      name: "pending-join",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
      // v0 held only a trip/group code.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as { code?: string | null; invite?: InviteLink | null; deferred?: boolean };
        if (version < 1) {
          return { invite: state.code ? { kind: "group", code: state.code } : null, deferred: !!state.deferred } as PendingJoinState;
        }
        return state as PendingJoinState;
      },
    },
  ),
);
