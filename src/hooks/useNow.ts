import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** The current time, refreshed on each minute boundary and when the app returns to the foreground. */
export function useNow(enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, 60_000 - (current.getTime() % 60_000) + 50);
    };
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    if (AppState.currentState === "active") tick();
    const subscription = AppState.addEventListener("change", (state) => {
      stop();
      if (state === "active") tick();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [enabled]);

  return now;
}
