import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { credentials, mmkvStateStorage, secureStore } from "@/modules/storage";

interface AuthUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
}

interface AuthState {
  user: AuthUser | null;
  isSignedIn: boolean;

  /** App lock: unlocks with the phone's own screen lock (biometrics or its PIN/passcode). Off by default. */
  lockEnabled: boolean;
  isUnlocked: boolean;
  lastActiveTimestamp: number | null;
  autoLockTimeout: number;

  setUser: (user: AuthUser | null) => void;
  setSignedIn: (value: boolean) => void;
  setLockEnabled: (value: boolean) => void;
  setUnlocked: (value: boolean) => void;
  updateLastActive: () => void;
  setAutoLockTimeout: (ms: number) => void;
  signOut: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isSignedIn: false,

      lockEnabled: false,
      isUnlocked: false,
      lastActiveTimestamp: null,
      autoLockTimeout: 60000,

      setUser: (user) => set({ user }),
      setSignedIn: (value) => set({ isSignedIn: value }),
      setLockEnabled: (value) => set({ lockEnabled: value }),
      setUnlocked: (value) => set({ isUnlocked: value }),
      updateLastActive: () => set({ lastActiveTimestamp: Date.now() }),
      setAutoLockTimeout: (ms) => set({ autoLockTimeout: ms }),
      signOut: () =>
        set({
          user: null,
          isSignedIn: false,
          isUnlocked: false,
          lastActiveTimestamp: null,
        }),
    }),
    {
      name: "auth-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 2,
      migrate: (persistedState, version) => {
        let state = (persistedState ?? {}) as Partial<AuthState> & Record<string, unknown>;
        if (state.autoLockTimeout === 0) state = { ...state, autoLockTimeout: 60000 };
        if (version < 2) {
          // The app PIN is gone: everyone starts with the lock off, and the old PIN hash is deleted.
          const { isPinSet: _pin, biometricEnabled: _bio, ...rest } = state;
          state = { ...rest, lockEnabled: false };
          void removeLegacyPin();
        }
        return state as AuthState;
      },
      partialize: (state) => ({
        user: state.user,
        isSignedIn: state.isSignedIn,
        lockEnabled: state.lockEnabled,
        autoLockTimeout: state.autoLockTimeout,
      }),
    },
  ),
);

/** Deletes the app PIN hash and attempt counter left by versions that had an app PIN. */
export async function removeLegacyPin() {
  await credentials.remove("nomadsafe-pin").catch(() => {});
  await secureStore.remove("nomadsafe.pin-attempts").catch(() => {});
}
