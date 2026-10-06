import type { BookingLike } from "@/features/itinerary/utils/bookings";
import { isForMe } from "@/features/itinerary/utils/people";
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

/** Everything on one calendar day, in order (a stay appears on its check-in and check-out days; "anytime" items at midnight). */
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

/** The entry in progress at `now` among `entries` (sorted); stays and notes never are. */
function inProgress<T extends BookingLike>(entries: TimelineEntry<T>[], now: number): TimelineEntry<T> | null {
  const nextIndex = entries.findIndex((entry) => time(entry.at) > now);
  const next = nextIndex >= 0 ? entries[nextIndex] : null;
  const started = nextIndex >= 0 ? entries.slice(0, nextIndex) : entries;
  return (
    [...started].reverse().find((entry) => {
      if (entry.role !== "single" || entry.event.type === "stay" || entry.event.type === "note") return false;
      const end = entry.event.endAt ? time(entry.event.endAt) : Math.min(time(entry.at) + OPEN_ENDED_MS, next ? time(next.at) : Infinity);
      return now < end;
    }) ?? null
  );
}

/** What you're doing at `now` and your next timed moment; done items and other people's plans are skipped. */
export function livePlan<T extends BookingLike>(events: T[], now: number): LivePlan<T> {
  const entries = timelineEntries(events.filter((event) => !event.timing && !event.doneAt && isForMe(event)));
  return { current: inProgress(entries, now), next: entries.find((entry) => time(entry.at) > now) ?? null };
}

/** Other people's plans in progress at `now` (shared and group trips), for the pass's "Meanwhile" line. */
export function othersNow<T extends BookingLike>(events: T[], now: number): TimelineEntry<T>[] {
  const theirs = events.filter((event) => !event.timing && !event.doneAt && !isForMe(event));
  const groups = new Map<string, T[]>();
  for (const event of theirs) {
    const key = [...(event.people ?? [])].sort().join("|");
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].flatMap((group) => inProgress(timelineEntries(group), now) ?? []);
}

/** "Anytime" items on `day`, not yet done first. */
export function anytimeOnDay<T extends BookingLike>(events: T[], day: Date): T[] {
  const key = startOfDay(day).getTime();
  return events
    .filter((event) => event.timing === "anytime" && startOfDay(event.startAt).getTime() === key)
    .sort((a, b) => Number(Boolean(a.doneAt)) - Number(Boolean(b.doneAt)));
}

export function wishlistOf<T extends BookingLike>(events: T[]): T[] {
  return events.filter((event) => event.timing === "wishlist");
}
