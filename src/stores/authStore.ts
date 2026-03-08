import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "./storage";

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

  isPinSet: boolean;
  biometricEnabled: boolean;
  isUnlocked: boolean;
  lastActiveTimestamp: number | null;
  autoLockTimeout: number;

  setUser: (user: AuthUser | null) => void;
  setSignedIn: (value: boolean) => void;
  setPinSet: (value: boolean) => void;
  setBiometricEnabled: (value: boolean) => void;
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

      isPinSet: false,
      biometricEnabled: false,
      isUnlocked: false,
      lastActiveTimestamp: null,
      autoLockTimeout: 0,

      setUser: (user) => set({ user }),
      setSignedIn: (value) => set({ isSignedIn: value }),
      setPinSet: (value) => set({ isPinSet: value }),
      setBiometricEnabled: (value) => set({ biometricEnabled: value }),
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
      partialize: (state) => ({
        user: state.user,
        isSignedIn: state.isSignedIn,
        isPinSet: state.isPinSet,
        biometricEnabled: state.biometricEnabled,
        autoLockTimeout: state.autoLockTimeout,
      }),
    },
  ),
);
