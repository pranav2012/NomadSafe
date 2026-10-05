import { useEffect, useMemo } from "react";
import * as Localization from "expo-localization";
import { COUNTRY_SHAPES } from "@/features/recap/data/countryShapes";
import { useBoundaryStore } from "@/features/recap/utils/boundaries";
import { countryAt } from "@/features/recap/utils/countryShapes";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { nearestCityCountry } from "@/features/trips/data/destinations";
import { getDestinationCoordinates, useTripsStore } from "@/features/trips/store/tripsStore";
import { countInclusiveDays, fromDateKey, getTripStatus } from "@/features/trips/utils/dates";
import { usePassportStore } from "../store/passportStore";
import { buildPassport, type Passport, type PassportTrip } from "../utils/passport";
import { regionAt } from "../utils/regions";

/** The country a point is in; coastal points the simplified outlines miss use the nearest bundled city. */
export function placeCountry(point: { latitude: number; longitude: number }): string | null {
  return countryAt(point.latitude, point.longitude) ?? nearestCityCountry(point.latitude, point.longitude);
}

export const continentOf = (country: string) => COUNTRY_SHAPES[country]?.[2] ?? null;

function deviceCountry(): string | null {
  const region = Localization.getLocales()[0]?.regionCode?.toUpperCase();
  return region && COUNTRY_SHAPES[region] ? region : null;
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

/** Stamps and state seals from every trip and past entry. */
export function usePassport(): Passport {
  const trips = useTripsStore((state) => state.trips);
  const entries = usePassportStore((state) => state.entries);
  const { code: home } = useHomeCountry();
  const view = useBoundaryStore((state) => state.view);

  return useMemo(() => {
    const passportTrips: PassportTrip[] = trips
      .filter((trip) => !trip.shared?.archived)
      .map((trip) => {
        const coordinates = getDestinationCoordinates(trip);
        return {
          id: trip.id,
          name: trip.name,
          startDate: trip.startDate,
          endDate: trip.endDate,
          days: countInclusiveDays(fromDateKey(trip.startDate), fromDateKey(trip.endDate)),
          status: getTripStatus(trip),
          stops: trip.destinations.map((name, i) => {
            const point = coordinates[i];
            const country = point ? placeCountry(point) : null;
            const region = point && country && country === home ? (regionAt(country, point.latitude, point.longitude)?.key ?? null) : null;
            return { name: name.split(",")[0].trim(), country, region };
          }),
        };
      });
    return buildPassport({ trips: passportTrips, past: entries, home, continentOf });
    // `view` changes which country and state a stop falls in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, entries, home, view]);
}
