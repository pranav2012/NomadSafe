import { localAuth } from "@/features/auth/services/localAuth";
import { useAuthStore } from "@/features/auth/store/authStore";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { logger } from "@/modules/logger";

/** True while LockGate covers the app; mirrors its condition in src/app/_layout.tsx. */
export function isAppLocked() {
  const { isSignedIn, lockEnabled, isUnlocked } = useAuthStore.getState();
  return useSettingsStore.getState().onboardingCompleted && isSignedIn && lockEnabled && !isUnlocked;
}

/**
 * Owner check before ending an SOS while locked: the phone's own unlock prompt.
 * Resolves false when cancelled or failed; the SOS keeps running and the user can try again.
 */
export async function authorizeSosCancel(promptMessage: string): Promise<boolean> {
  if (!isAppLocked()) return true;
  try {
    const result = await localAuth.authenticate(promptMessage);
    if (result === "noScreenLock") useAuthStore.getState().setLockEnabled(false);
    if (result === "ok" || result === "noScreenLock") {
      useAuthStore.getState().setUnlocked(true);
      return true;
    }
  } catch (err) {
    logger.warn("safety", "owner check for SOS cancel failed", err);
  }
  return false;
}
