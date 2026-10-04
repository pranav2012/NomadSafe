import { router } from "expo-router";
import { localAuth } from "@/features/auth/services/localAuth";
import { pinAttempts } from "@/features/auth/services/pinAttempts";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { logger } from "@/services/logger";
import { useSafetyStore } from "../store/safetyStore";

let stopWaiting: (() => void) | null = null;

/** True while LockGate covers the app; mirrors its condition in src/app/_layout.tsx. */
export function isAppLocked() {
  const { isSignedIn, isPinSet, isUnlocked } = useAuthStore.getState();
  return useSettingsStore.getState().onboardingCompleted && isSignedIn && isPinSet && !isUnlocked;
}

/** Reopens the Safety tab once the app is unlocked, if the SOS is still running. */
function returnToSosAfterUnlock() {
  stopWaiting?.();
  const unsubscribe = useAuthStore.subscribe((state) => {
    if (!state.isSignedIn) {
      stopWaiting?.();
      return;
    }
    if (!state.isUnlocked) return;
    stopWaiting?.();
    if (useSafetyStore.getState().status === "emergency") router.navigate("/(tabs)/sos");
  });
  stopWaiting = () => {
    unsubscribe();
    stopWaiting = null;
  };
}

/**
 * Owner check before ending an SOS while locked: in-app biometrics, else the lock screen's PIN.
 * Resolves false when sent to the lock screen; the SOS keeps running meanwhile.
 */
export async function authorizeSosCancel(promptMessage: string, cancelLabel: string): Promise<boolean> {
  if (!isAppLocked()) return true;
  if (useAuthStore.getState().biometricEnabled) {
    try {
      if (await localAuth.authenticateWithBiometric({ promptMessage, cancelLabel })) {
        void pinAttempts.reset();
        useAuthStore.getState().setUnlocked(true);
        return true;
      }
    } catch (err) {
      logger.warn("safety", "biometric check for SOS cancel failed", err);
    }
  }
  // Leaving the Safety tab lets LockGate show the PIN pad.
  returnToSosAfterUnlock();
  router.navigate("/(tabs)");
  return false;
}
