import { useEffect, useState } from "react";
import { health, type HealthAvailability, type WalkingTotals } from "@/modules/health";
import { track } from "@/modules/analytics";
import { withSystemPrompt } from "@/utils/systemPrompt";
import type { Trip } from "@/features/trips/store/tripsStore";
import { getTripStatus } from "@/features/trips/utils/dates";
import { useRecapStore } from "../store/recapStore";
import { walkingStale, walkingWindow } from "../utils/moments";

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

  useEffect(() => {
    if (!trip || !ended || !linked || availability !== "available" || !walkingStale(cached?.at, trip.endDate)) return;
    const { start, end } = walkingWindow(trip);
    void health.readWalking(start, end).then((totals) => useRecapStore.getState().setWalking(trip.id, totals));
  }, [availability, cached?.at, ended, linked, trip]);

  const link = async (): Promise<WalkingTotals | null> => {
    const granted = await withSystemPrompt(() => health.requestAccess());
    track("steps_linked", { source: health.source ?? "none", granted });
    useRecapStore.getState().setHealthLinked(granted);
    if (!granted || !trip) return null;
    const { start, end } = walkingWindow(trip);
    const totals = await health.readWalking(start, end);
    useRecapStore.getState().setWalking(trip.id, totals);
    return totals;
  };

  return {
    totals: cached ?? null,
    /** Offer "Add steps" only for ended trips, where a health store exists and isn't linked yet. */
    canLink: ended && !linked && (availability === "available" || availability === "needs_update"),
    needsInstall: availability === "needs_update",
    linked,
    source: health.source,
    link,
    openInstall: health.openInstall,
  };
}
