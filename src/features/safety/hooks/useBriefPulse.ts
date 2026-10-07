import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";

// About three LiveDot ripples (1.6 s each).
const ANDROID_PULSE_MS = 5000;

/**
 * Whether a LiveDot should ripple. On Android it ripples a few times each time it turns on or the
 * screen comes back, then rests as a solid dot, so a status dot doesn't keep the UI thread
 * drawing frames. iOS keeps rippling while `active`.
 */
export function useBriefPulse(active: boolean) {
  const visible = useAnimationsActive();
  const on = active && visible;
  const [prevOn, setPrevOn] = useState(on);
  const [expired, setExpired] = useState(false);
  if (on !== prevOn) {
    setPrevOn(on);
    setExpired(false);
  }

  useEffect(() => {
    if (Platform.OS !== "android" || !on) return;
    const id = setTimeout(() => setExpired(true), ANDROID_PULSE_MS);
    return () => clearTimeout(id);
  }, [on]);

  return active && !expired;
}
