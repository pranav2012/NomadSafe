import { useMemo } from "react";
import { useHomeCountry } from "@/features/passport/hooks/usePassport";
import { countryAt } from "@/features/recap/utils/countryShapes";
import { nearestCityCountry } from "@/features/trips/data/destinations";
import { getDestinationCoordinates, type Trip } from "@/features/trips/store/tripsStore";
import { addDays, countInclusiveDays, fromDateKey } from "@/features/trips/utils/dates";
import { useEventsStore, type TripEvent } from "@/features/itinerary/store/eventsStore";
import { usePlaceLookupStore } from "@/features/itinerary/store/placeLookupStore";
import { useTicketsStore } from "@/features/itinerary/store/ticketsStore";
import { learnedMinutes, mealWindowsFor, missingInfo } from "@/features/itinerary/utils/dayShape";
import { placeQuery, stopForItem } from "@/features/itinerary/utils/placeQuery";
import { toWallClock } from "@/features/itinerary/utils/wallClock";

export type TripStop = { name: string; latitude: number; longitude: number };

/** What the day plan and the trip summary need about a trip: its items, stops, meal times per day, usual lengths and what's missing. */
export function useTripPlanContext(trip: Trip) {
  const events = useEventsStore((state) => state.events);
  const tried = usePlaceLookupStore((state) => state.tried);
  const tickets = useTicketsStore((state) => state.tickets);
  const homeCountry = useHomeCountry().code;

  const tripEvents = useMemo(
    () => events.filter((event) => event.tripId === trip.id).sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()),
    [events, trip.id],
  );
  const stops = useMemo<TripStop[]>(
    () => getDestinationCoordinates(trip).flatMap((coord, i) => (coord ? [{ name: trip.destinations[i] ?? "", latitude: coord.latitude, longitude: coord.longitude }] : [])),
    [trip],
  );
  const days = useMemo(() => {
    const start = fromDateKey(trip.startDate);
    return Array.from({ length: Math.max(1, countInclusiveDays(start, fromDateKey(trip.endDate))) }, (_, i) => addDays(start, i));
  }, [trip.endDate, trip.startDate]);
  const stays = tripEvents.filter((event) => event.type === "stay");
  const ticketEventIds = new Set(tickets.map((ticket) => ticket.eventId));
  const placeFailedIds = new Set(Object.entries(tried).flatMap(([id, attempt]) => (attempt.found ? [] : [id])));
  const learned = learnedMinutes(tripEvents);

  const stopOn = (day: Date): TripStop | null => stopForItem(trip, stops, stays, toWallClock(day));
  const mealsOn = (day: Date) => {
    const stop = stopOn(day);
    const country = stop ? (countryAt(stop.latitude, stop.longitude) ?? nearestCityCountry(stop.latitude, stop.longitude)) : null;
    return mealWindowsFor(country, tripEvents);
  };
  // Items named too vaguely to search for ("Dinner") ask for a place straight away.
  const placeFailed = (event: TripEvent) => placeFailedIds.has(event.id) || (!event.place && !event.timing && placeQuery(event) === null);
  const missingOf = (event: TripEvent) => missingInfo(event, { hasTicket: ticketEventIds.has(event.id), placeFailed: placeFailed(event) });

  const placeFailedIdsAll = new Set([...placeFailedIds, ...tripEvents.filter(placeFailed).map((event) => event.id)]);

  return { tripEvents, days, stops, learned, homeCountry, ticketEventIds, placeFailedIds: placeFailedIdsAll, stopOn, mealsOn, missingOf };
}
