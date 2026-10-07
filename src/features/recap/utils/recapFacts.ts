import type { TransitMode } from "@/features/itinerary/constants/eventTypes";
import { parseRouteEnds, transitModeOf } from "@/features/itinerary/utils/transit";
import { countInclusiveDays, fromDateKey } from "@/features/trips/utils/dates";
import { distanceKm, type MapPoint } from "@/features/trips/utils/mapFraming";

export type RecapMode = TransitMode | "other";
/** Distance buckets: a mode, or "likelyFlight" for long legs no booking covers. */
export type RecapDistanceMode = RecapMode | "likelyFlight";

export interface RecapStop extends MapPoint {
  name: string;
  /** ISO 3166-1 alpha-2, or null when it couldn't be placed. */
  country: string | null;
}

export interface RecapLeg {
  from: string;
  to: string;
  km: number;
  /** From the transit event that covers this leg; null when the itinerary has none. */
  mode: TransitMode | null;
  /** Day the covering transit event left ("YYYY-MM-DD"); null when no event covers the leg. */
  date: string | null;
}

export interface RecapFacts {
  days: number;
  stops: RecapStop[];
  /** Countries in the order the trip first reached them. */
  countries: string[];
  legs: RecapLeg[];
  totalKm: number;
  kmByMode: Partial<Record<RecapDistanceMode, number>>;
  /** Transit events per mode, counted even when their route couldn't be placed. */
  tripsByMode: Partial<Record<TransitMode, number>>;
  stays: number;
  activities: number;
}

export interface RecapInput {
  trip: { startDate: string; endDate: string; destinations: string[] };
  /** Index-aligned with `trip.destinations`. */
  coordinates: (MapPoint | null)[];
  events: { type: string; title: string; detail?: string; transitMode?: TransitMode; startAt: string }[];
  /** Offline lookup for route ends such as "Hue"; null when unknown. */
  locate: (place: string) => MapPoint | null;
  countryOf: (point: MapPoint) => string | null;
}

// A journey ending this close to a stop is taken to be the leg into it.
const MATCH_KM = 80;
/** Legs with no booking at least this long are counted as likely flights (Tokyo → Sapporo, Paris → Rome). */
export const LIKELY_FLIGHT_KM = 700;

interface Journey {
  from: MapPoint;
  to: MapPoint;
  km: number;
  mode: TransitMode | null;
  date: string;
}

/**
 * Trip numbers for the replay and share card. Distance counts each placed transit event once, plus
 * the straight line for any leg between stops that no transit event covers.
 */
export function computeRecapFacts({ trip, coordinates, events, locate, countryOf }: RecapInput): RecapFacts {
  const stops: RecapStop[] = trip.destinations.flatMap((name, i) => {
    const coord = coordinates[i];
    return coord ? [{ name, latitude: coord.latitude, longitude: coord.longitude, country: countryOf(coord) }] : [];
  });
  const countries = [...new Set(stops.flatMap((stop) => (stop.country ? [stop.country] : [])))];

  const transit = events.filter((event) => event.type === "transit").sort((a, b) => a.startAt.localeCompare(b.startAt));
  const tripsByMode: Partial<Record<TransitMode, number>> = {};
  const journeys: Journey[] = [];
  for (const event of transit) {
    const mode = transitModeOf(event) ?? null;
    if (mode) tripsByMode[mode] = (tripsByMode[mode] ?? 0) + 1;
    const ends = parseRouteEnds(event.detail) ?? parseRouteEnds(event.title);
    if (!ends) continue;
    const from = locate(ends[0]);
    const to = locate(ends[1]);
    if (!from || !to) continue;
    journeys.push({ from, to, km: distanceKm(from, to), mode, date: event.startAt.slice(0, 10) });
  }

  const covered = new Set<Journey>();
  const legs: RecapLeg[] = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    const journey = journeys.find(
      (candidate) => !covered.has(candidate) && distanceKm(candidate.from, a) <= MATCH_KM && distanceKm(candidate.to, b) <= MATCH_KM,
    );
    if (journey) covered.add(journey);
    legs.push({ from: a.name, to: b.name, km: distanceKm(a, b), mode: journey?.mode ?? null, date: journey?.date ?? null });
  }

  const kmByMode: Partial<Record<RecapDistanceMode, number>> = {};
  const addKm = (mode: RecapDistanceMode, km: number) => {
    kmByMode[mode] = (kmByMode[mode] ?? 0) + km;
  };
  for (const journey of journeys) addKm(journey.mode ?? "other", journey.km);
  for (const leg of legs) if (leg.mode === null) addKm(leg.km >= LIKELY_FLIGHT_KM ? "likelyFlight" : "other", leg.km);
  const totalKm = Object.values(kmByMode).reduce((sum, km) => sum + (km ?? 0), 0);

  return {
    days: countInclusiveDays(fromDateKey(trip.startDate), fromDateKey(trip.endDate)),
    stops,
    countries,
    legs,
    totalKm,
    kmByMode,
    tripsByMode,
    stays: events.filter((event) => event.type === "stay").length,
    activities: events.filter((event) => event.type === "activity").length,
  };
}
