import { useEffect, useState } from "react";
import { health, type HealthAvailability } from "@/modules/health";
import { track } from "@/modules/analytics";
import { withSystemPrompt } from "@/utils/systemPrompt";
import type { Trip } from "@/features/trips/store/tripsStore";
import { getTripStatus } from "@/features/trips/utils/dates";
import { useRecapStore, type TripWalking } from "../store/recapStore";
import { walkingStale, walkingWindow } from "../utils/moments";

/** Reads a trip's totals and per-day steps and stores them; null when there was nothing. */
async function readTrip(trip: Trip): Promise<TripWalking | null> {
  const { start, end } = walkingWindow(trip);
  const [totals, daily] = await Promise.all([health.readWalking(start, end), health.readDailySteps(start, end)]);
  useRecapStore.getState().setWalking(trip.id, totals ? { ...totals, daily: daily ?? undefined } : null);
  return useRecapStore.getState().walking[trip.id] ?? null;
}

/**
 * Steps and walking distance for an ended trip, from Health Connect / Apple Health once the user has
 * linked it (read on this phone, cached per trip). `link` asks for access, then reads.
 */
export function useTripWalking(trip: Trip | null) {
  const linked = useRecapStore((state) => state.healthLinked);
  const cached = useRecapStore((state) => (trip ? state.walking[trip.id] : undefined));
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const ended = trip ? getTripStatus(trip) === "complete" : false;

  useEffect(() => {
    let alive = true;
    void health.availability().then((value) => alive && setAvailability(value));
    return () => {
      alive = false;
    };
  }, []);

  const stale = !cached || !cached.daily || walkingStale(cached.at, trip?.endDate ?? "");
  useEffect(() => {
    if (!trip || !ended || !linked || availability !== "available" || !stale) return;
    void readTrip(trip);
  }, [availability, ended, linked, stale, trip]);

  const link = async (): Promise<TripWalking | null> => {
    const granted = await withSystemPrompt(() => health.requestAccess());
    track("steps_linked", { source: health.source ?? "none", granted });
    useRecapStore.getState().setHealthLinked(granted);
    if (!granted || !trip) return null;
    return readTrip(trip);
  };

  return {
    totals: cached ?? null,
    /** A health store exists on this phone (Health Connect may need installing first). */
    available: availability === "available" || availability === "needs_update",
    /** Offer "Add steps" only for ended trips, where a health store exists and isn't linked yet. */
    canLink: ended && !linked && (availability === "available" || availability === "needs_update"),
    needsInstall: availability === "needs_update",
    linked,
    source: health.source,
    link,
    openInstall: health.openInstall,
  };
}
