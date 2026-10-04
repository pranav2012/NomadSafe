import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { notifications, useLastNotificationTap } from "@/modules/notifications";
import { TRIP_NOTIFICATION_SOURCE } from "../services/tripPush";

/** Taps on shared-trip notifications open that trip's Money tab. Mount once inside the root navigator. */
export function useTripNotificationRouting() {
  const router = useRouter();
  const data = useLastNotificationTap();

  useEffect(() => {
    if (!data) return;
    if (data.source !== TRIP_NOTIFICATION_SOURCE || typeof data.tripId !== "string") return;
    const trip = useTripsStore.getState().trips.find((item) => item.shared?.tripId === data.tripId);
    if (trip) useTripsStore.getState().setActiveTrip(trip.id);
    router.navigate("/(tabs)/expenses");
    notifications.clearLastTap();
  }, [data, router]);
}
