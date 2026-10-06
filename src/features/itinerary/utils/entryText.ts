import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { localizeEventDetail, localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { nightsBetween, type TimelineEntry } from "@/features/itinerary/utils/timeline";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

const LEGACY_HEADS = new Set(["Check-in", "Check-out", "Departure", "Arrival"]);

export function formatters(locale: string, hour12: boolean) {
  return {
    time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12 }),
    weekdayDay: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }),
    monthDay: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
    dayHeader: new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }),
  };
}

/** "Departure · BLR → NRT" (older events) or "BLR → NRT" → "BLR → NRT". */
export function routeOf(detail: string | undefined): string {
  if (!detail) return "";
  const [head, ...rest] = detail.split(" · ");
  return LEGACY_HEADS.has(head) ? rest.join(" · ") : detail;
}

export interface Described {
  title: string;
  sub: string;
}

/** Title and subtitle for one booking: stays show their dates and nights, flights their route and arrival. */
export function describe(event: TripEvent, t: Translate, format: ReturnType<typeof formatters>, now: number): Described {
  const name = localizeEventTitle(event.title, t);
  if (event.type === "stay") {
    if (!event.endAt) return { title: name, sub: localizeEventDetail(event.detail, t) ?? t("itinerary.defaults.checkIn") };
    const end = new Date(event.endAt);
    const inProgress = new Date(event.startAt).getTime() <= now && now < end.getTime();
    return {
      title: name,
      sub: inProgress
        ? t("itinerary.stayingNow", { date: format.monthDay.format(end) })
        : `${format.monthDay.format(new Date(event.startAt))} → ${format.monthDay.format(end)} · ${t("itinerary.nights", { count: nightsBetween(event.startAt, event.endAt) })}`,
    };
  }
  if (event.type === "transit") {
    const route = routeOf(event.detail);
    const arrives = event.endAt ? t("itinerary.arrives", { time: format.time.format(new Date(event.endAt)) }) : null;
    return { title: route || name, sub: [route ? name : null, arrives].filter(Boolean).join(" · ") };
  }
  return { title: name, sub: localizeEventDetail(event.detail, t) ?? "" };
}

/** Title and subtitle for one timeline moment: a stay's check-in or check-out, or a single item. */
export function describeEntry(entry: TimelineEntry<TripEvent>, t: Translate, format: ReturnType<typeof formatters>, now: number): Described {
  const name = localizeEventTitle(entry.event.title, t);
  if (entry.role === "check-in") {
    const nights = entry.event.endAt ? t("itinerary.nights", { count: nightsBetween(entry.event.startAt, entry.event.endAt) }) : null;
    return { title: name, sub: [t("itinerary.defaults.checkIn"), nights].filter(Boolean).join(" · ") };
  }
  if (entry.role === "check-out") return { title: name, sub: t("itinerary.defaults.checkOut") };
  return describe(entry.event, t, format, now);
}
