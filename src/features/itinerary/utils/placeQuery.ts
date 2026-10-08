import { stopOnDay, stopSchedule } from "@/features/recap/utils/replayFacts";
import type { MapPoint } from "@/features/trips/utils/mapFraming";
import { parseRouteEnds, transitModeOf } from "@/features/itinerary/utils/transit";
import type { PlacedEvent } from "@/features/itinerary/utils/dayShape";

const GENERIC_TITLES = new Set(["hotel stay", "flight", "activity", "stay", "hotel", "dinner", "lunch", "breakfast"]);
const STATION_SUFFIX = { train: "station", bus: "bus station", ferry: "ferry terminal" } as const;

/** What to search for to place an item on the map, or null when it can't or needn't be placed. */
export function placeQuery(event: PlacedEvent & { where?: string }): string | null {
  if (event.place || event.timing === "wishlist") return null;
  const where = event.where?.trim();
  if (where) return where;
  if (event.type === "transit") {
    const mode = transitModeOf(event);
    if (!mode || mode === "flight" || mode === "car") return null;
    const to = parseRouteEnds(event.detail)?.[1] ?? parseRouteEnds(event.title)?.[1];
    return to ? `${to} ${STATION_SUFFIX[mode]}` : null;
  }
  if (event.type === "note") return null;
  const title = event.title.trim();
  return title.length >= 3 && !GENERIC_TITLES.has(title.toLowerCase()) ? title : null;
}

/** The trip stop an item's day is spent at, to bias the search; the first stop when unsure. */
export function stopForItem<S extends MapPoint & { name: string }>(
  trip: { startDate: string; endDate: string },
  stops: S[],
  stays: { title: string; detail?: string; startAt: string }[],
  startAt: string,
): S | null {
  if (stops.length === 0) return null;
  const schedule = stopSchedule({ startDate: trip.startDate, endDate: trip.endDate, stops, legDates: stops.slice(1).map(() => null), stays });
  return stops[stopOnDay(schedule, startAt.slice(0, 10)) ?? 0] ?? stops[0];
}
