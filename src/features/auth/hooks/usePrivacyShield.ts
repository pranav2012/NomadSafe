import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import { isSystemPromptOpen } from "@/utils/systemPrompt";
import { useAuthStore } from "../store/authStore";

/**
 * iOS: true while the app is inactive or in the background with a PIN set, so the app switcher
 * snapshot shows a cover instead of the screen. Android hides recents in MainActivity
 * (plugins/withRecentsPrivacy.js) instead.
 */
export function usePrivacyShield() {
  const isSignedIn = useAuthStore((s) => s.isSignedIn);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const [away, setAway] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const subscription = AppState.addEventListener("change", (state) => {
      // Inactive also covers the app switcher, but not system sheets the app opened itself.
      setAway(state === "background" || (state === "inactive" && !isSystemPromptOpen()));
    });
    return () => subscription.remove();
  }, []);

  return away && isSignedIn && isPinSet;
}
