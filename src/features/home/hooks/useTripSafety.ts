import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { areaKey, readPlacesCache, writePlacesCache } from "@/features/places/services/placesCache";
import { logger } from "@/services/logger";
import type { HomeStop } from "@/features/home/types";

export type SafetyKind = "hospital" | "police" | "pharmacy";

export interface SafetyPlace {
  kind: SafetyKind;
  name: string;
  address: string;
  phone: string | null;
  latitude: number;
  longitude: number;
  mapsUrl: string | null;
}

export interface PlacePin {
  name: string;
  latitude: number;
  longitude: number;
}

// Results are kept on the phone (placesCache) so reopening Home doesn't re-query Places. A fetch
// also lands in state, which is what re-renders; the cache only serves results from an earlier mount.
const keyFor = (stop: HomeStop) => areaKey(stop.latitude, stop.longitude);

/** Hospitals, police and pharmacies near a stop (nearest first), or null while loading. */
export function useSafetyPlaces(stop: HomeStop | undefined) {
  const search = useAction(api.places.searchSafetyPlaces);
  const key = stop ? `safety:${keyFor(stop)}` : null;
  const [fetched, setFetched] = useState<{ key: string; places: SafetyPlace[] } | null>(null);
  const cached = useMemo(() => (key ? readPlacesCache<SafetyPlace[]>(key) : undefined), [key]);

  useEffect(() => {
    if (!stop || !key || cached) return;
    let mounted = true;
    search({ latitude: stop.latitude, longitude: stop.longitude })
      .then((result) => {
        writePlacesCache(key, result);
        if (mounted) setFetched({ key, places: result });
      })
      .catch((error: unknown) => {
        logger.warn("safety-map", "safety places unavailable", error);
        if (mounted) setFetched({ key, places: [] });
      });
    return () => {
      mounted = false;
    };
  }, [cached, key, search, stop]);

  if (!key) return null;
  return fetched?.key === key ? fetched.places : (cached ?? null);
}

/** Coordinates for the trip's hotel (an itinerary stay), looked up by name near the stop. */
export function useHotelPin(stop: HomeStop | undefined, hotelName: string | undefined) {
  const find = useAction(api.places.findPlaceByName);
  const key = stop && hotelName ? `hotel:${hotelName}|${keyFor(stop)}` : null;
  const [fetched, setFetched] = useState<{ key: string; hotel: PlacePin | null } | null>(null);
  const cached = useMemo(() => (key ? readPlacesCache<{ hotel: PlacePin | null }>(key) : undefined), [key]);

  useEffect(() => {
    if (!stop || !hotelName || !key || cached) return;
    let mounted = true;
    find({ query: hotelName, latitude: stop.latitude, longitude: stop.longitude })
      .then((result) => {
        writePlacesCache(key, { hotel: result });
        if (mounted) setFetched({ key, hotel: result });
      })
      .catch(() => {
        if (mounted) setFetched({ key, hotel: null });
      });
    return () => {
      mounted = false;
    };
  }, [cached, find, hotelName, key, stop]);

  if (!key) return null;
  return fetched?.key === key ? fetched.hotel : (cached?.hotel ?? null);
}
