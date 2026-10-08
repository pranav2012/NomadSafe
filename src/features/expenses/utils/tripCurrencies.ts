import { countryAt } from "@/features/recap/utils/countryShapes";
import { nearestCityCountry } from "@/features/trips/data/destinations";
import type { Trip } from "@/features/trips/store/tripsStore";
import { countryFacts } from "@/features/trips/utils/countryFacts";

/** Local currencies of a trip's destinations other than `home`, in route order. */
export function tripForeignCurrencies(trip: Pick<Trip, "destinationCoordinates">, home: string): string[] {
  const currencies = (trip.destinationCoordinates ?? []).flatMap((point) => {
    if (!point) return [];
    const country = countryAt(point.latitude, point.longitude) ?? nearestCityCountry(point.latitude, point.longitude);
    const currency = countryFacts(country)?.currency;
    return currency && currency !== home ? [currency] : [];
  });
  return [...new Set(currencies)];
}
