import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useGmailStatus } from "@/features/expenses/hooks/useGmailStatus";
import { syncTripGmail } from "@/features/expenses/services/tripGmailSync";
import { selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";

/** Syncs the active trip's new Gmail mail on every app open and when its dates or destinations change. */
export function useTripGmailSync(): void {
  const trip = useTripsStore(selectActiveTrip);
  const { connected } = useGmailStatus();
  const tripRef = useRef(trip);
  const tripKey = trip ? [trip.id, trip.startDate, trip.endDate, ...trip.destinations].join("|") : null;

  useEffect(() => {
    tripRef.current = trip;
  });

  useEffect(() => {
    if (!connected || !tripKey) return;
    const run = () => {
      const current = tripRef.current;
      if (current) syncTripGmail(current).catch(() => undefined);
    };
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, [connected, tripKey]);
}
