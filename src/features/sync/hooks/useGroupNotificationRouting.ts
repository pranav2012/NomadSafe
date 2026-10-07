import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { useMoneyViewStore } from "@/features/expenses/store/moneyViewStore";
import { useSavedSheetStore } from "@/features/itinerary/store/savedSheetStore";
import { notifications, useLastNotificationTap } from "@/modules/notifications";
import { GROUP_NOTIFICATION_SOURCE } from "../services/groupPush";

/**
 * Taps on shared trip or group notifications open Money; a "send me the ticket" ask opens the
 * ticket (with Send) when it's on this phone; saved ideas open the Saved sheet and a confirmed
 * planned trip opens Home on it. Mount once inside the root navigator.
 */
export function useGroupNotificationRouting() {
  const router = useRouter();
  const data = useLastNotificationTap();

  useEffect(() => {
    if (!data) return;
    if (data.source !== GROUP_NOTIFICATION_SOURCE || typeof data.groupId !== "string") return;
    const planned = useTripsStore.getState().plannedTrips.find((item) => item.shared?.groupId === data.groupId);
    const confirmed = data.type === "confirmed" ? useTripsStore.getState().trips.find((item) => item.shared?.groupId === data.groupId) : undefined;
    if (planned || confirmed || data.type === "ideas") {
      if (confirmed) useTripsStore.getState().setActiveTrip(confirmed.id);
      router.navigate("/(tabs)");
      const target = planned ?? confirmed ?? useTripsStore.getState().trips.find((item) => item.shared?.groupId === data.groupId);
      if (data.type === "ideas" && target) useSavedSheetStore.getState().show(target.id, "ideas", "push");
      notifications.clearLastTap();
      return;
    }
    // Only a trip becomes the active trip; a group's money opens without changing it.
    const trip = useTripsStore.getState().trips.find((item) => item.shared?.groupId === data.groupId);
    const group = useTripsStore.getState().groups.find((item) => item.shared?.groupId === data.groupId);
    if (trip) useTripsStore.getState().setActiveTrip(trip.id);
    useMoneyViewStore.getState().select(trip?.id ?? group?.id ?? null);
    const eventId = data.type === "ticket_ask" && typeof data.eventId === "string" ? data.eventId : null;
    if (eventId && useTicketsStore.getState().tickets.some((ticket) => ticket.eventId === eventId)) {
      router.push({ pathname: "/ticket/[eventId]", params: { eventId } });
    } else {
      router.navigate(eventId ? "/(tabs)" : "/(tabs)/expenses");
    }
    notifications.clearLastTap();
  }, [data, router]);
}
