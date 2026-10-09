import { useEffect } from "react";
import * as Localization from "expo-localization";
import { useNow } from "@/hooks/useNow";
import { useBoundaryStore, type BoundaryView } from "@/features/recap/utils/boundaries";
import { countryAt, countryContinent } from "@/features/recap/utils/countryShapes";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { nearestCityCountry } from "@/features/trips/data/destinations";
import { isArchivedGroup, getDestinationCoordinates, useTripsStore } from "@/features/trips/store/tripsStore";
import { countInclusiveDays, fromDateKey, getTripStatus, toDateKey } from "@/features/trips/utils/dates";
import { usePassportStore, type PastTravel } from "../store/passportStore";
import { buildPassport, type Passport, type PassportTrip } from "../utils/passport";
import { regionAt } from "../utils/regions";

/** The country a point is in; coastal points the simplified outlines miss use the nearest bundled city. */
export function placeCountry(point: { latitude: number; longitude: number }, view?: BoundaryView): string | null {
  return countryAt(point.latitude, point.longitude, view) ?? nearestCityCountry(point.latitude, point.longitude);
}

export const continentOf = (country: string) => countryContinent(country);

function deviceCountry(): string | null {
  const region = Localization.getLocales()[0]?.regionCode?.toUpperCase();
  return region && countryContinent(region) !== null ? region : null;
}

/** `useHomeCountry().code` outside React: the Settings pick, else the phone's region. */
export function homeCountryCode(): string | null {
  return useSettingsStore.getState().homeCountry ?? deviceCountry();
}

/** The user's home country: their pick in Settings, else the phone's region. */
export function useHomeCountry(): { code: string | null; automatic: boolean; device: string | null } {
  const picked = useSettingsStore((state) => state.homeCountry);
  const device = deviceCountry();
  return { code: picked ?? device, automatic: picked === null, device };
}

/** India's official borders for people in India (phone region or home country), the default otherwise. Mount once at the root. */
export function useBoundaryViewSync() {
  const picked = useSettingsStore((state) => state.homeCountry);
  useEffect(() => {
    const device = deviceCountry();
    useBoundaryStore.getState().setView(picked === "IN" || device === "IN" ? "IN" : "default");
  }, [picked]);
}

type Trips = ReturnType<typeof useTripsStore.getState>["trips"];

let cached: { trips: Trips; entries: PastTravel[]; home: string | null; view: BoundaryView; day: string; passport: Passport } | null = null;

/**
 * The passport for these inputs, shared by every screen that shows it (the book's pages, the card,
 * the replay), so it's built once per change rather than once per component. `view` changes which
 * country and state a stop falls in; `day` re-checks which trips are over after midnight.
 */
function passportFor(trips: Trips, entries: PastTravel[], home: string | null, view: BoundaryView, day: string): Passport {
  if (cached && cached.trips === trips && cached.entries === entries && cached.home === home && cached.view === view && cached.day === day) {
    return cached.passport;
  }
  const now = fromDateKey(day);
  const passportTrips: PassportTrip[] = trips
    .filter((trip) => !isArchivedGroup(trip))
    .map((trip) => {
      const coordinates = getDestinationCoordinates(trip);
      return {
        id: trip.id,
        name: trip.name,
        startDate: trip.startDate,
        endDate: trip.endDate,
        days: countInclusiveDays(fromDateKey(trip.startDate), fromDateKey(trip.endDate)),
        status: getTripStatus(trip, now),
        stops: trip.destinations.map((name, i) => {
          const point = coordinates[i];
          const country = point ? placeCountry(point, view) : null;
          const region = point && country && country === home ? (regionAt(country, point.latitude, point.longitude)?.key ?? null) : null;
          return { name: name.split(",")[0].trim(), country, region };
        }),
      };
    });
  const passport = buildPassport({ trips: passportTrips, past: entries, home, continentOf });
  cached = { trips, entries, home, view, day, passport };
  return passport;
}

/** Stamps and state seals from every trip and past entry. */
export function usePassport(): Passport {
  const trips = useTripsStore((state) => state.trips);
  const entries = usePassportStore((state) => state.entries);
  const { code: home } = useHomeCountry();
  const view = useBoundaryStore((state) => state.view);
  const day = toDateKey(useNow());
  return passportFor(trips, entries, home, view, day);
}
