import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "expo-router";
import { useAuthStore } from "@/features/auth/store/authStore";

/** True while the app is in the foreground. */
export function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setActive(next === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

/** Screen focused, app foregrounded and not under the PIN lock; tab freezing doesn't stop UI-thread worklets. */
export function useAnimationsActive() {
  const focused = useIsFocused();
  const appActive = useAppActive();
  const lockCovering = useAuthStore((s) => s.isSignedIn && s.isPinSet && !s.isUnlocked);
  return focused && appActive && !lockCovering;
}
