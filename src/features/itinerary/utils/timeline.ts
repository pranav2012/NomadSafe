import type { BookingLike } from "@/features/itinerary/utils/bookings";

export type TimelineRole = "single" | "check-in" | "check-out";

export interface TimelineEntry<T extends BookingLike> {
  event: T;
  at: string;
  role: TimelineRole;
}

export type TimelineSection<T extends BookingLike> =
  | { kind: "day"; day: Date; entries: TimelineEntry<T>[] }
  /** Consecutive days with nothing planned, inside a stay. */
  | { kind: "staying"; from: Date; to: Date; event: T };

const DAY_MS = 86_400_000;
// Times are either UTC instants or zone-less wall-clock strings, so compare parsed values, not text.
const time = (value: string) => new Date(value).getTime();

const startOfDay = (value: string | Date) => {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const shiftDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const isLoneCheckOut = (event: BookingLike) => event.detail?.split(" · ")[0] === "Check-out";

export function nightsBetween(startAt: string, endAt: string): number {
  return Math.max(0, Math.round((startOfDay(endAt).getTime() - startOfDay(startAt).getTime()) / DAY_MS));
}

/** The next few things on the trip: anything not yet over, including a stay in progress. */
export function upNext<T extends BookingLike>(events: T[], now: number, count: number): T[] {
  const sorted = [...events].sort((a, b) => time(a.startAt) - time(b.startAt));
  const open = sorted.filter((event) => new Date(event.endAt ?? event.startAt).getTime() >= now);
  return (open.length > 0 ? open : sorted.slice(-count)).slice(0, count);
}

/** Day-by-day itinerary: a stay shows check-in and check-out, and the quiet days between collapse into one line. */
export function buildTimeline<T extends BookingLike>(events: T[]): TimelineSection<T>[] {
  const entries: TimelineEntry<T>[] = [];
  for (const event of events) {
    if (event.type === "stay" && isLoneCheckOut(event)) {
      entries.push({ event, at: event.startAt, role: "check-out" });
    } else if (event.type === "stay") {
      entries.push({ event, at: event.startAt, role: "check-in" });
      if (event.endAt) entries.push({ event, at: event.endAt, role: "check-out" });
    } else {
      entries.push({ event, at: event.startAt, role: "single" });
    }
  }
  entries.sort((a, b) => time(a.at) - time(b.at));

  const days = new Map<number, TimelineEntry<T>[]>();
  for (const entry of entries) {
    const key = startOfDay(entry.at).getTime();
    days.set(key, [...(days.get(key) ?? []), entry]);
  }

  const sections: TimelineSection<T>[] = [...days.entries()].map(([key, dayEntries]) => ({
    kind: "day",
    day: new Date(key),
    entries: dayEntries,
  }));

  for (const stay of events) {
    if (stay.type !== "stay" || !stay.endAt || isLoneCheckOut(stay)) continue;
    let rangeStart: Date | null = null;
    const last = startOfDay(stay.endAt).getTime();
    // Step by calendar day, not 24h, so DST changes don't knock days off local midnight.
    for (let day = shiftDays(startOfDay(stay.startAt), 1); day.getTime() <= last; day = shiftDays(day, 1)) {
      const quiet = day.getTime() < last && !days.has(day.getTime());
      if (quiet && !rangeStart) rangeStart = day;
      if (!quiet && rangeStart) {
        sections.push({ kind: "staying", from: rangeStart, to: shiftDays(day, -1), event: stay });
        rangeStart = null;
      }
    }
  }

  const sectionTime = (section: TimelineSection<T>) => (section.kind === "day" ? section.day : section.from).getTime();
  return sections.sort((a, b) => sectionTime(a) - sectionTime(b));
}
