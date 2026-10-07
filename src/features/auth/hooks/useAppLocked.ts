import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useAuthStore } from "../store/authStore";

/** True while the app lock applies and the app hasn't been unlocked (LockGate's base condition). */
export function useAppLocked() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const lockEnabled = useAuthStore((s) => s.lockEnabled);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  return onboardingCompleted && isSignedIn && lockEnabled && !isUnlocked;
}
