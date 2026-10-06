import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { notifications, useLastNotificationTap } from "@/modules/notifications";
import { TRIP_NOTIFICATION_SOURCE } from "../services/tripPush";

/**
 * Taps on shared-trip notifications open that trip's Money tab; a "send me the ticket" ask opens the
 * ticket (with Send) when it's on this phone. Mount once inside the root navigator.
 */
export function useTripNotificationRouting() {
  const router = useRouter();
  const data = useLastNotificationTap();

  useEffect(() => {
    if (!data) return;
    if (data.source !== TRIP_NOTIFICATION_SOURCE || typeof data.tripId !== "string") return;
    const trip = useTripsStore.getState().trips.find((item) => item.shared?.tripId === data.tripId);
    if (trip) useTripsStore.getState().setActiveTrip(trip.id);
    const eventId = data.type === "ticket_ask" && typeof data.eventId === "string" ? data.eventId : null;
    if (eventId && useTicketsStore.getState().tickets.some((ticket) => ticket.eventId === eventId)) {
      router.push({ pathname: "/ticket/[eventId]", params: { eventId } });
    } else {
      router.navigate(eventId ? "/(tabs)" : "/(tabs)/expenses");
    }
    notifications.clearLastTap();
  }, [data, router]);
}
