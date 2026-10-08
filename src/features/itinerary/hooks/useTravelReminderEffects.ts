import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";
import { notifications, useLastNotificationTap } from "@/modules/notifications";
import { useHomeCountry } from "@/features/passport/hooks/usePassport";
import { isArchivedGroup, useTripsStore } from "@/features/trips/store/tripsStore";
import { toDateKey } from "@/features/trips/utils/dates";
import { TRAVEL_NOTIFICATION_SOURCE, syncTravelReminders } from "@/features/itinerary/services/travelReminders";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";

/** Keeps "leave by" / "boarding soon" reminders in step with the itinerary, and opens the ticket (or that day's plan) from a tap. Mount once in the root navigator. */
export function useTravelReminderEffects() {
  const router = useRouter();
  const { locale, hour12 } = useLocalization();
  const events = useEventsStore((state) => state.events);
  const trips = useTripsStore((state) => state.trips);
  const homeCountry = useHomeCountry().code;
  const tap = useLastNotificationTap();

  useEffect(() => {
    void syncTravelReminders(
      events,
      trips.filter((trip) => !isArchivedGroup(trip)),
      homeCountry,
      { locale, hour12 },
    ).then((added) => {
      if (added > 0) track("travel_reminders_scheduled", { count: added });
    });
  }, [events, trips, homeCountry, locale, hour12]);

  useEffect(() => {
    if (!tap || tap.source !== TRAVEL_NOTIFICATION_SOURCE || typeof tap.eventId !== "string") return;
    notifications.clearLastTap();
    const event = useEventsStore.getState().events.find((item) => item.id === tap.eventId);
    if (!event?.tripId) return;
    if (useTicketsStore.getState().tickets.some((ticket) => ticket.eventId === event.id)) {
      router.push({ pathname: "/ticket/[eventId]", params: { eventId: event.id } });
    } else {
      router.push({ pathname: "/trip-plan/[id]", params: { id: event.tripId, date: toDateKey(new Date(event.startAt)) } });
    }
  }, [tap, router]);
}
