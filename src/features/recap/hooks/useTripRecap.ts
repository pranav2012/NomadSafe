import { useMemo } from "react";
import { useTripExpenseSummary } from "@/features/expenses/hooks/useTripExpenseSummary";
import { formatMoney } from "@/features/expenses/utils/money";
import { useEventsStore } from "@/features/itinerary/store/eventsStore";
import type { TransitMode } from "@/features/itinerary/constants/eventTypes";
import { placeCountry } from "@/features/passport/hooks/usePassport";
import { countryDisplayName } from "@/features/trips/data/destinations";
import { airportCoordinates } from "@/features/itinerary/utils/airports";
import { getOfflineCoordinates } from "@/features/trips/services/geocoding";
import { getDestinationCoordinates, useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { fromDateKey } from "@/features/trips/utils/dates";
import { useLocalization } from "@/localization";
import type { RecapCardContent } from "../components/recapCard";
import { useBoundaryStore } from "../utils/boundaries";
import { countryBox } from "../utils/countryShapes";
import { computeRecapFacts, type RecapFacts, type RecapMode } from "../utils/recapFacts";

export interface RecapStat {
  key: "days" | "stops" | "distance";
  value: string;
  label: string;
}

const MODE_ORDER: TransitMode[] = ["flight", "train", "bus", "ferry", "car"];
const VIA_SHOWN = 4;

export const shortPlace = (name: string) => name.split(",")[0].trim();

/** Three-letter board code: Latin letters of the city name, else its first characters (e.g. 東京). */
export function placeCode(name: string): string {
  const short = shortPlace(name);
  const latin = short.replace(/[^A-Za-z]/g, "");
  return (latin.length >= 2 ? latin : short.replace(/\s/g, "")).slice(0, 3).toUpperCase() || "—";
}

function formatDateRange(trip: Trip, locale: string) {
  const start = fromDateKey(trip.startDate);
  const end = fromDateKey(trip.endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startText = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }).format(start);
  const endText = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(end);
  return trip.startDate === trip.endDate ? endText : `${startText} – ${endText}`;
}

function listFormat(items: string[], locale: string) {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** A route end from an itinerary event: an airport code ("NRT") or a place name ("Hue"). */
const locateRouteEnd = (place: string) => airportCoordinates(place) ?? getOfflineCoordinates(place);

/** Everything the replay and share card show for one trip, formatted; null when the trip is gone. */
export function useTripRecap(tripId: string | undefined) {
  const { t, locale, formatDistance, formatCurrency } = useLocalization();
  const trip = useTripsStore((state) => state.trips.find((item) => item.id === tripId) ?? null);
  const allEvents = useEventsStore((state) => state.events);
  const summary = useTripExpenseSummary(trip);
  const view = useBoundaryStore((state) => state.view);

  const facts = useMemo<RecapFacts | null>(
    () =>
      trip
        ? computeRecapFacts({
            trip,
            coordinates: getDestinationCoordinates(trip),
            events: allEvents.filter((event) => event.tripId === trip.id),
            locate: locateRouteEnd,
            countryOf: placeCountry,
          })
        : null,
    // `view` changes which country a stop falls in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trip, allEvents, view],
  );

  if (!trip || !facts) return null;

  const spend = summary.convertedExpenses.length > 0 ? formatMoney(formatCurrency, summary.total, trip.currency) : null;
  const places = trip.destinations.map(shortPlace);
  const first = places[0] ?? trip.name;
  const last = places[places.length - 1] ?? first;
  const middle = places.slice(1, -1);
  const countryNames = facts.countries.map((code) => countryDisplayName(code, locale));
  const distance = facts.totalKm >= 1 ? formatDistance(facts.totalKm) : null;

  const title = places.length > 1 ? t("recap.fromTo", { from: first, to: last }) : first;
  const via =
    middle.length === 0
      ? null
      : middle.length <= VIA_SHOWN
        ? t("recap.via", { places: listFormat(middle, locale) })
        : t("recap.via", { places: listFormat([...middle.slice(0, VIA_SHOWN - 1), t("recap.more", { count: middle.length - VIA_SHOWN + 1 })], locale) });

  const modeSummary = listFormat(
    MODE_ORDER.filter((mode) => (facts.tripsByMode[mode] ?? 0) > 0).map((mode) => t(`recap.modeCount.${mode}`, { count: facts.tripsByMode[mode] ?? 0 })),
    locale,
  );

  const stats: RecapStat[] = [
    { key: "days", value: String(facts.days), label: t("recap.daysAway", { count: facts.days }) },
    { key: "stops", value: String(places.length), label: t("recap.cities", { count: places.length }) },
  ];
  if (distance) stats.splice(1, 0, { key: "distance", value: distance, label: t("recap.travelled") });

  const legendModes: RecapMode[] = [...new Set(facts.legs.map((leg) => leg.mode ?? "other"))];
  const startLabel = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(fromDateKey(trip.startDate));

  /** Card content; spend stays off unless the user turns it on. */
  const cardContent = (includeSpend: boolean): RecapCardContent => {
    const cardStats: RecapCardContent["stats"] = stats.map(({ key, value, label }) =>
      key === "distance"
        ? { value, label, count: facts.totalKm, kind: "distance" as const }
        : { value, label, count: key === "days" ? facts.days : places.length, kind: "int" as const },
    );
    if (cardStats.length < 3 && countryNames.length > 1)
      cardStats.push({ value: String(countryNames.length), label: t("recap.countries", { count: countryNames.length }), count: countryNames.length, kind: "int" });
    if (includeSpend && spend) cardStats.splice(Math.min(2, cardStats.length), 1, { value: spend, label: t("recap.spent") });
    return {
      codes: places.length > 1 ? [placeCode(first), placeCode(last)] : [placeCode(first)],
      title,
      via,
      stops: facts.stops,
      legs: facts.legs,
      countries: facts.countries,
      region: facts.stops.length === 1 && facts.countries[0] ? countryBox(facts.countries[0]) : null,
      stamp: countryNames[0] ? { title: countryNames[0], detail: t("recap.arrived", { date: startLabel }) } : null,
      legend: legendModes.map((mode) => ({ mode, label: mode === "other" ? t("recap.legendOther") : t(`itinerary.transitModes.${mode}`) })),
      stats: cardStats.slice(0, 3),
      footer: t("recap.footer"),
      dates: formatDateRange(trip, locale),
      promo: t("recap.promo"),
      brand: "NomadSafe",
    };
  };

  return {
    trip,
    facts,
    places,
    title,
    via,
    dates: formatDateRange(trip, locale),
    /** "21 days in Japan" for a one-country trip, else the trip's own name. */
    headline: countryNames.length === 1 ? t("recap.daysIn", { count: facts.days, place: countryNames[0] }) : trip.name,
    distance,
    modeSummary,
    stats,
    spend,
    hasSplits: Boolean(trip.companions.length > 0 || trip.shared),
    cardContent,
  };
}

export type TripRecap = NonNullable<ReturnType<typeof useTripRecap>>;
