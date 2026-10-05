import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useAuthStore } from "../store/authStore";

/** True while the PIN lock applies and the app hasn't been unlocked (LockGate's base condition). */
export function useAppLocked() {
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  return onboardingCompleted && isSignedIn && isPinSet && !isUnlocked;
}
