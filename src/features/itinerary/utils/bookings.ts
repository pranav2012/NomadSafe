import type { EventTiming, EventType, TransitMode } from "@/features/itinerary/constants/eventTypes";

export interface BookingLike {
  type: EventType;
  title: string;
  detail?: string;
  startAt: string;
  endAt?: string;
  source?: "manual" | "email";
  externalId?: string;
  sourceIds?: string[];
  bookingRef?: string;
  transitMode?: TransitMode;
  timing?: EventTiming;
  people?: string[];
  doneAt?: string;
}

interface StoredBooking extends BookingLike {
  id: string;
  tripId: string | null;
  createdAt: string;
}

// Titles that name the booking site or the kind of booking rather than the place itself.
const GENERIC_TITLES = new Set([
  "booking", "reservation", "your booking", "booking confirmation", "confirmation", "hotel", "hotel stay", "stay",
  "hostel", "flight", "your flight", "trip", "booking com", "agoda", "airbnb", "expedia", "hotels com", "trip com",
  "makemytrip", "goibibo", "cleartrip", "hostelworld", "ixigo", "easemytrip", "yatra",
]);
const FILLER_TOKENS = new Set([
  "the", "hotel", "hostel", "hostels", "resort", "inn", "booking", "reservation", "confirmation", "confirmed",
  "your", "stay", "flight", "airline", "airlines", "com",
]);
const LEGACY_DETAILS = new Set(["Check-in", "Check-out", "Departure", "Arrival"]);
const DAY_MS = 86_400_000;

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.has(normalizeTitle(title));
}

function distinctiveTokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((token) => token.length >= 3 && !FILLER_TOKENS.has(token)));
}

/** Same place or carrier, allowing for "X", "X Booking" and a generic "Booking" from another email. */
function titlesMatch(a: string, b: string, allowGeneric: boolean): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (x === y || (x && y && (x.includes(y) || y.includes(x)))) return true;
  if (allowGeneric && (isGenericTitle(a) || isGenericTitle(b))) return true;
  const tx = distinctiveTokens(x);
  const ty = distinctiveTokens(y);
  if (tx.size === 0 || ty.size === 0) return false;
  const shared = [...tx].filter((token) => ty.has(token)).length;
  return shared / Math.min(tx.size, ty.size) >= 0.6;
}

const localDay = (iso: string) => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/** "Departure · BKK → HKT" → "BKK → HKT"; plain details are returned as is. */
function routeOf(detail: string | undefined): string {
  if (!detail) return "";
  const [head, ...rest] = detail.split(" · ");
  return LEGACY_DETAILS.has(head) ? rest.join(" · ") : detail;
}

const headOf = (detail: string | undefined) => detail?.split(" · ")[0];
const isLoneCheckOut = (event: BookingLike) => headOf(event.detail) === "Check-out";
const endOf = (event: BookingLike) => event.endAt ?? (isLoneCheckOut(event) ? event.startAt : undefined);

/** Whether two events describe the same booking, e.g. a confirmation and a reminder for one stay. */
export function sameBooking(a: BookingLike, b: BookingLike): boolean {
  if (a.type !== b.type) return false;
  if (a.bookingRef && b.bookingRef) return a.bookingRef === b.bookingRef;
  if (!titlesMatch(a.title, b.title, a.type !== "activity")) return false;
  const sameStart = localDay(a.startAt) === localDay(b.startAt);
  if (a.type === "stay") {
    const endA = endOf(a);
    const endB = endOf(b);
    if (isLoneCheckOut(a) || isLoneCheckOut(b)) return Boolean(endA && endB && localDay(endA) === localDay(endB));
    return sameStart || Boolean(endA && endB && localDay(endA) === localDay(endB));
  }
  if (a.type === "transit") {
    const routeA = routeOf(a.detail);
    const routeB = routeOf(b.detail);
    return sameStart && (!routeA || !routeB || routeA === routeB);
  }
  return sameStart;
}

function pickTitle(current: string, incoming: string): string {
  if (isGenericTitle(current) && !isGenericTitle(incoming)) return incoming;
  if (isGenericTitle(incoming)) return current;
  const x = normalizeTitle(current);
  const y = normalizeTitle(incoming);
  return x.includes(y) && y.length < x.length ? incoming : current;
}

const sourceIdsOf = (event: BookingLike) =>
  [event.externalId, ...(event.sourceIds ?? [])].filter((id): id is string => Boolean(id));

/** Fields to update on `existing` when `incoming` turns out to be the same booking. */
export function mergeBooking(existing: BookingLike, incoming: BookingLike): Partial<BookingLike> {
  const sourceIds = [...new Set([...sourceIdsOf(existing), ...sourceIdsOf(incoming)])];
  // Same booking number: emails are merged oldest first, so the newer one (e.g. "updated booking") wins.
  if (existing.bookingRef && existing.bookingRef === incoming.bookingRef) {
    return {
      title: pickTitle(existing.title, incoming.title),
      detail: incoming.detail || existing.detail,
      startAt: incoming.startAt,
      endAt: incoming.endAt ?? existing.endAt,
      transitMode: existing.transitMode ?? incoming.transitMode,
      sourceIds,
    };
  }
  return {
    title: pickTitle(existing.title, incoming.title),
    detail: existing.detail || routeOf(incoming.detail) || undefined,
    endAt: existing.endAt ?? incoming.endAt,
    bookingRef: existing.bookingRef ?? incoming.bookingRef,
    transitMode: existing.transitMode ?? incoming.transitMode,
    sourceIds: sourceIds.length > 0 ? sourceIds : undefined,
  };
}

/** Joins a legacy check-in/departure event with its later check-out/arrival. */
function pairLegacy<T extends StoredBooking>(events: T[], open: string, close: string, maxDays: number): T[] {
  const closers = events.filter((event) => headOf(event.detail) === close);
  const used = new Set<string>();
  const result: T[] = [];
  for (const event of events) {
    if (headOf(event.detail) === close) continue;
    if (headOf(event.detail) !== open) {
      result.push(event);
      continue;
    }
    const start = new Date(event.startAt).getTime();
    const match = closers
      .filter((candidate) => !used.has(candidate.id) && candidate.tripId === event.tripId)
      .filter((candidate) => {
        const gap = new Date(candidate.startAt).getTime() - start;
        return gap > 0 && gap <= maxDays * DAY_MS && titlesMatch(event.title, candidate.title, true);
      })
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())[0];
    if (match) used.add(match.id);
    const route = routeOf(event.detail) || routeOf(match?.detail);
    result.push({
      ...event,
      detail: route || undefined,
      endAt: event.endAt ?? match?.startAt,
      sourceIds: match ? [...new Set([...sourceIdsOf(event), ...sourceIdsOf(match)])] : event.sourceIds,
    });
  }
  return [...result, ...closers.filter((event) => !used.has(event.id))];
}

/** One-time cleanup of older Gmail events: joins check-in/out and departure/arrival pairs and merges copies of one booking. */
export function consolidateEmailBookings<T extends StoredBooking>(events: T[]): T[] {
  const manual = events.filter((event) => event.source !== "email");
  let email = events.filter((event) => event.source === "email");
  email = pairLegacy(email, "Check-in", "Check-out", 60);
  email = pairLegacy(email, "Departure", "Arrival", 2);

  const merged: T[] = [];
  for (const event of [...email].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const index = merged.findIndex((existing) => existing.tripId === event.tripId && sameBooking(existing, event));
    if (index < 0) {
      merged.push(event);
      continue;
    }
    // A full stay absorbs a lone check-out, never the other way round.
    const [base, other] = isLoneCheckOut(merged[index]) && !isLoneCheckOut(event) ? [event, merged[index]] : [merged[index], event];
    merged[index] = { ...base, ...mergeBooking(base, other) };
  }
  return [...manual, ...merged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
