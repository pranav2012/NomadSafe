import { useCallback } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { useEventsStore } from "@/features/itinerary";
import { selectActiveTrip, useTripsStore } from "@/features/trips/store/tripsStore";
import { homeStage } from "@/features/home/utils/stage";
import { track } from "@/modules/analytics";

function trackHomeViewed() {
  const now = new Date();
  const trip = selectActiveTrip(useTripsStore.getState()) ?? null;
  const events = trip ? useEventsStore.getState().events.filter((event) => event.tripId === trip.id) : [];
  const today = toLocalDayKey(now);
  track("home_viewed", {
    stage: homeStage(trip, now),
    events_today: events.filter((event) => toLocalDayKey(event.startAt) === today).length,
    trip_events: events.length,
  });
}

/** Sends `home_viewed` each time Home gets focus, and each time the app returns to the foreground on Home. */
export function useHomeViewed() {
  useFocusEffect(
    useCallback(() => {
      trackHomeViewed();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") trackHomeViewed();
      });
      return () => subscription.remove();
    }, []),
  );
}
