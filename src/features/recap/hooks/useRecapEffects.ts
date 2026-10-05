import { useEffect } from "react";
import { useRouter } from "expo-router";
import { notifications, useLastNotificationTap } from "@/modules/notifications";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useRecapStore } from "../store/recapStore";
import { RECAP_NOTIFICATION_SOURCE, syncRecapNotifications } from "../services/recapNotifications";

/** Keeps trip-end notifications in step with the trips, and opens the replay from a tap. Mount once in the root navigator. */
export function useRecapEffects() {
  const router = useRouter();
  const trips = useTripsStore((state) => state.trips);
  const finished = useRecapStore((state) => state.finished);
  const tap = useLastNotificationTap();

  useEffect(() => {
    void syncRecapNotifications(trips, finished);
  }, [trips, finished]);

  useEffect(() => {
    if (!tap || tap.source !== RECAP_NOTIFICATION_SOURCE || typeof tap.tripId !== "string") return;
    notifications.clearLastTap();
    if (!useTripsStore.getState().trips.some((trip) => trip.id === tap.tripId)) return;
    router.push({ pathname: "/trip-recap/[id]", params: { id: tap.tripId, source: "notification" } });
  }, [tap, router]);
}
