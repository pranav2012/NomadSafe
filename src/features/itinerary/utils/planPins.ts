import type { EventType } from "@/features/itinerary/constants/eventTypes";
import { dayEntries, endpoints, type PlacedEvent } from "@/features/itinerary/utils/dayShape";
import { isForMe } from "@/features/itinerary/utils/people";
import type { MapPoint } from "@/features/trips/utils/mapFraming";

export interface DayPins {
  date: Date;
  pins: (MapPoint & { id: string; label: string; type: EventType })[];
  path: MapPoint[];
}

/** Your placed items per day as numbered pins (1, 2, 3… within the day) and the path through them in order. */
export function planPins<T extends PlacedEvent>(events: T[], days: Date[]): DayPins[] {
  const mine = events.filter(isForMe);
  return days.map((date) => {
    const pins: DayPins["pins"] = [];
    const path: MapPoint[] = [];
    const seen = new Set<string>();
    for (const entry of dayEntries(mine, date)) {
      const { start, end } = endpoints(entry.event);
      const at = entry.role === "single" && entry.event.type === "transit" ? start : end;
      for (const point of entry.event.type === "transit" && entry.role === "single" ? [start, end] : [at]) {
        if (point) path.push(point);
      }
      if (!at || seen.has(entry.event.id)) continue;
      seen.add(entry.event.id);
      pins.push({ ...at, id: `${entry.event.id}-${entry.role}`, label: String(pins.length + 1), type: entry.event.type });
    }
    return { date, pins, path };
  });
}
