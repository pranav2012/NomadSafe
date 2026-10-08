import { useEffect } from "react";
import { api, useAction, useConvexAuth } from "@/modules/backend";
import { withAppCheck } from "@/modules/appCheck";
import { logger } from "@/modules/logger";
import { getDestinationCoordinates, type Trip } from "@/features/trips/store/tripsStore";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import { usePlaceLookupStore } from "@/features/itinerary/store/placeLookupStore";
import { placeQuery, stopForItem } from "@/features/itinerary/utils/placeQuery";

const BATCH = 10;
const RETRY_AFTER_MS = 10 * 60_000;

let pausedUntil = 0;
let running = false;

/** Looks up each placeless item once by name near its stop (Google Places, batched) and saves the place on the item, so it syncs. */
export function useItineraryPlaces(trip: Trip | null) {
  const { isAuthenticated } = useConvexAuth();
  const find = useAction(api.places.findItineraryPlaces);
  const events = useEventsStore((state) => state.events);
  const tried = usePlaceLookupStore((state) => state.tried);

  useEffect(() => {
    if (!trip || !isAuthenticated || running || Date.now() < pausedUntil) return;
    const stops = getDestinationCoordinates(trip).flatMap((coord, i) => (coord ? [{ name: trip.destinations[i] ?? "", ...coord }] : []));
    if (stops.length === 0) return;
    const tripEvents = events.filter((event) => event.tripId === trip.id);
    const stays = tripEvents.filter((event) => event.type === "stay");
    const pending = tripEvents
      .flatMap((event) => {
        const query = placeQuery(event);
        if (!query || tried[event.id]?.query === query) return [];
        const stop = stopForItem(trip, stops, stays, event.startAt);
        return stop ? [{ event, query, stop }] : [];
      })
      .slice(0, BATCH);
    if (pending.length === 0) return;

    running = true;
    const items = pending.map(({ query, stop }) => {
      const city = stop.name.split(",")[0].trim();
      return { query: city && !query.toLowerCase().includes(city.toLowerCase()) ? `${query}, ${city}` : query, latitude: stop.latitude, longitude: stop.longitude };
    });
    withAppCheck({ items })
      .then(find)
      .then((results) => {
        running = false;
        useEventsStore.getState().updateEvents(
          pending.flatMap(({ event }, i) => {
            const found = results[i];
            return found ? [{ id: event.id, input: { place: found } }] : [];
          }),
        );
        usePlaceLookupStore.getState().record(pending.map(({ event, query }, i) => ({ eventId: event.id, query, found: Boolean(results[i]) })));
      })
      .catch((error: unknown) => {
        pausedUntil = Date.now() + RETRY_AFTER_MS;
        logger.warn("itinerary-places", "lookup failed", error);
      })
      .finally(() => {
        running = false;
      });
  }, [events, find, isAuthenticated, tried, trip]);
}
