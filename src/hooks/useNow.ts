import { useEffect, useMemo, useState } from "react";
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

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Local midnight of today; re-renders only when the calendar day changes (checked at midnight and on foreground). */
export function useToday(): Date {
  const [key, setKey] = useState(() => dayKey(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const current = new Date();
      setKey(dayKey(current));
      const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = setTimeout(tick, nextMidnight.getTime() - current.getTime() + 50);
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
  }, []);

  return useMemo(() => {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month, day);
  }, [key]);
}
