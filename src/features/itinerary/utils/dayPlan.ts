import type { BookingLike } from "@/features/itinerary/utils/bookings";
import { nightsBetween, timelineEntries, type TimelineEntry } from "@/features/itinerary/utils/timeline";

// An item without an end time counts as "now" for this long, or until the next item starts.
const OPEN_ENDED_MS = 60 * 60_000;

const time = (value: string) => new Date(value).getTime();
const startOfDay = (value: string | Date) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
const nextDay = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

export interface TonightStay<T> {
  event: T;
  night: number;
  nights: number;
}

export interface LivePlan<T extends BookingLike> {
  current: TimelineEntry<T> | null;
  next: TimelineEntry<T> | null;
}

/** Everything on one calendar day, in order (a stay appears on its check-in and check-out days). */
export function entriesOnDay<T extends BookingLike>(events: T[], day: Date): TimelineEntry<T>[] {
  const from = startOfDay(day).getTime();
  const to = nextDay(startOfDay(day)).getTime();
  return timelineEntries(events).filter((entry) => time(entry.at) >= from && time(entry.at) < to);
}

/** The stay whose nights cover the evening of `day`. */
export function tonightStay<T extends BookingLike>(events: T[], day: Date): TonightStay<T> | null {
  const target = startOfDay(day).getTime();
  for (const event of events) {
    if (event.type !== "stay" || !event.endAt) continue;
    const first = startOfDay(event.startAt).getTime();
    if (target < first || target >= startOfDay(event.endAt).getTime()) continue;
    return { event, night: nightsBetween(event.startAt, day.toISOString()) + 1, nights: nightsBetween(event.startAt, event.endAt) };
  }
  return null;
}

/** What's happening at `now` (not stays, which are "tonight") and the next moment after it. */
export function livePlan<T extends BookingLike>(events: T[], now: number): LivePlan<T> {
  const entries = timelineEntries(events);
  const nextIndex = entries.findIndex((entry) => time(entry.at) > now);
  const next = nextIndex >= 0 ? entries[nextIndex] : null;
  const started = nextIndex >= 0 ? entries.slice(0, nextIndex) : entries;
  const current =
    [...started].reverse().find((entry) => {
      if (entry.role !== "single" || entry.event.type === "stay") return false;
      const end = entry.event.endAt ? time(entry.event.endAt) : Math.min(time(entry.at) + OPEN_ENDED_MS, next ? time(next.at) : Infinity);
      return now < end;
    }) ?? null;
  return { current, next };
}
