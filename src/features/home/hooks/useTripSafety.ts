import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
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

// Session caches so reopening Home doesn't re-query Places. A fetch also lands in state, which
// is what re-renders; the cache is only read for results from an earlier mount.
const placesCache = new Map<string, SafetyPlace[]>();
const hotelCache = new Map<string, PlacePin | null>();

const keyFor = (stop: HomeStop) => `${stop.latitude.toFixed(3)},${stop.longitude.toFixed(3)}`;

/** Hospitals, police and pharmacies near a stop (nearest first), or null while loading. */
export function useSafetyPlaces(stop: HomeStop | undefined) {
  const search = useAction(api.places.searchSafetyPlaces);
  const key = stop ? keyFor(stop) : null;
  const [fetched, setFetched] = useState<{ key: string; places: SafetyPlace[] } | null>(null);

  useEffect(() => {
    if (!stop || !key || placesCache.has(key)) return;
    let mounted = true;
    search({ latitude: stop.latitude, longitude: stop.longitude })
      .then((result) => {
        placesCache.set(key, result);
        if (mounted) setFetched({ key, places: result });
      })
      .catch((error: unknown) => {
        logger.warn("safety-map", "safety places unavailable", error);
        if (mounted) setFetched({ key, places: [] });
      });
    return () => {
      mounted = false;
    };
  }, [key, search, stop]);

  if (!key) return null;
  return fetched?.key === key ? fetched.places : (placesCache.get(key) ?? null);
}

/** Coordinates for the trip's hotel (an itinerary stay), looked up by name near the stop. */
export function useHotelPin(stop: HomeStop | undefined, hotelName: string | undefined) {
  const find = useAction(api.places.findPlaceByName);
  const key = stop && hotelName ? `${hotelName}|${keyFor(stop)}` : null;
  const [fetched, setFetched] = useState<{ key: string; hotel: PlacePin | null } | null>(null);

  useEffect(() => {
    if (!stop || !hotelName || !key || hotelCache.has(key)) return;
    let mounted = true;
    find({ query: hotelName, latitude: stop.latitude, longitude: stop.longitude })
      .then((result) => {
        hotelCache.set(key, result);
        if (mounted) setFetched({ key, hotel: result });
      })
      .catch(() => {
        if (mounted) setFetched({ key, hotel: null });
      });
    return () => {
      mounted = false;
    };
  }, [find, hotelName, key, stop]);

  if (!key) return null;
  return fetched?.key === key ? fetched.hotel : (hotelCache.get(key) ?? null);
}
