import {
  hotelNameFromEmail,
  isFlightEmail,
  isStayEmail,
  merchantFromSender,
  type RawMessage,
} from "@/features/expenses/services/transactionParser";
import { matchEmailProvider } from "@/features/expenses/services/emailProviders";
import type { Trip } from "@/features/trips/store/tripsStore";
import {
  eventFingerprint,
  useEventsStore,
  type EventSource,
} from "@/features/itinerary/store/eventsStore";
import type { EventType } from "@/features/itinerary/constants/eventTypes";
import { fromDateKey } from "@/features/trips/utils/dates";
import { countAttributes, logger } from "@/modules/logger";
import { floatingTime, parseBookingEmail } from "@/features/itinerary/services/bookingEmailParser";

export interface BuildEventsOptions {
  /** Events are scoped to the selected trip's date window. */
  trip?: Trip | null;
}

export interface EventCandidate {
  id: string;
  type: EventType;
  title: string;
  detail?: string;
  startAt: string;
  /** Check-out for a stay, arrival for a flight. */
  endAt?: string;
  source: EventSource;
  rawText?: string;
  note?: string;
  externalId?: string;
  bookingRef?: string;
  /** A cancellation email: the caller removes the matching booking. */
  cancelled?: boolean;
  /** Already present in the itinerary. */
  duplicate: boolean;
}

interface ExtractedEvent {
  type: EventType;
  title: string;
  detail: string;
  date: string;
  endDate?: string;
  bookingRef?: string;
  cancelled?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Only travel/booking emails are worth parsing; keeps the scan off receipts,
// payment alerts, and other noise.
const ITINERARY_HINT =
  /\b(?:flight|airline|airport|boarding|e-ticket|pnr|train|rail|bus|ferry|cruise|hotel|hostel|resort|stay|accommodation|check[- ]?in|check[- ]?out|booking|reservation|itinerary|tour)\b/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function monthIndex(name: string): number | null {
  const key = name.slice(0, 3).toLowerCase();
  return key in MONTHS ? MONTHS[key] : null;
}

function looksLikeItinerary(message: RawMessage): boolean {
  return ITINERARY_HINT.test(`${message.sender ?? ""} ${message.body}`);
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** True when the email names one of the trip's destinations, so an unrelated
 *  booking never lands in this trip's itinerary. */
function mentionsDestination(message: RawMessage, trip: Trip): boolean {
  const email = normalizedText(`${message.body} ${message.sender ?? ""}`);
  return destinationTokens(trip).some((token) => email.includes(token));
}

function destinationTokens(trip: Trip): string[] {
  return trip.destinations.flatMap((destination) =>
    normalizedText(destination)
      .split(/[,/()\-]+/)
      .flatMap((part) => part.trim().split(/\s+/))
      .filter(
        (token) =>
          token.length >= 4 &&
          !["city", "municipality", "subdistrict", "thailand", "district"].includes(token),
      ),
  );
}

interface DatedHit {
  date: Date;
  index: number;
}

/** Builds a local date, rejecting overflow such as 31/02 rolling into March. */
function safeDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

/**
 * Finds all calendar dates in the text along with their position, so a nearby
 * time can be attached. Handles ISO, "26 Jun 2026", "Jun 26, 2026", and numeric
 * d/m/y or m/d/y. Numeric order is inferred from an unambiguous date in the same
 * email (a part > 12); ambiguous ones are skipped when the order is unknown or a
 * month-name/ISO date is already present.
 */
function extractDatedHits(text: string): DatedHit[] {
  const hits: DatedHit[] = [];
  const push = (date: Date | null, index: number) => {
    if (date) hits.push({ date, index });
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(safeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])), m.index ?? 0);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const month = monthIndex(m[2]);
    if (month != null) push(safeDate(Number(m[3]), month, Number(m[1])), m.index ?? 0);
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = monthIndex(m[1]);
    if (month != null) push(safeDate(Number(m[3]), month, Number(m[2])), m.index ?? 0);
  }

  const numeric = [...text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g)].map((m) => ({
    first: Number(m[1]),
    second: Number(m[2]),
    year: Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]),
    index: m.index ?? 0,
  }));
  const dayFirst = numeric.some((n) => n.first > 12 && n.second <= 12);
  const monthFirst = numeric.some((n) => n.second > 12 && n.first <= 12);
  const order = dayFirst === monthFirst ? null : dayFirst ? "dmy" : "mdy";
  const hasNamedDates = hits.length > 0;
  for (const n of numeric) {
    const ambiguous = n.first <= 12 && n.second <= 12 && n.first !== n.second;
    if (ambiguous && (!order || hasNamedDates)) continue;
    const useDayFirst = order ? order === "dmy" : n.first > 12;
    push(
      useDayFirst
        ? safeDate(n.year, n.second - 1, n.first)
        : safeDate(n.year, n.first - 1, n.second),
      n.index,
    );
  }

  return hits;
}

/** Looks for a clock time within a small window around `index`. */
function timeNear(text: string, index: number): { hour: number; minute: number } | null {
  const slice = text.slice(Math.max(0, index - 30), index + 50);
  const withMinutes = slice.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (withMinutes) {
    let hour = Number(withMinutes[1]);
    const minute = Number(withMinutes[2]);
    const meridiem = withMinutes[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour < 24 && minute < 60) return { hour, minute };
  }
  const hourOnly = slice.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (hourOnly) {
    let hour = Number(hourOnly[1]);
    const meridiem = hourOnly[2].toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour < 24) return { hour, minute: 0 };
  }
  return null;
}

function withinWindow(date: Date, trip: Trip): boolean {
  const start = fromDateKey(trip.startDate).getTime() - DAY_MS;
  const end = fromDateKey(trip.endDate).getTime() + DAY_MS;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return day >= start && day <= end;
}

/** Wall-clock time at the destination, stored without a zone so it doesn't shift when the phone changes zone. */
function applyTime(date: Date, time: { hour: number; minute: number } | null, fallbackHour: number): string {
  return floatingTime(
    { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() },
    time?.hour ?? fallbackHour,
    time?.minute ?? 0,
  );
}

const INSURANCE = /\binsurance\b/i;

/** Pulls an airport-code route like "BKK → HKT" when present. */
function routeDetail(text: string): string {
  const match = text.match(/\b([A-Z]{3})\s*(?:[–\-]|→|to)\s*([A-Z]{3})\b/);
  return match ? `${match[1]} → ${match[2]}` : "";
}

const ACTIVITY_HINT =
  /\b(?:tour|activity|activities|ticket|admission|experience|attraction|excursion|museum|safari|show|workshop|class)\b/i;

/** Index of the first keyword match, or -1. */
function keywordIndex(text: string, re: RegExp): number {
  return text.match(re)?.index ?? -1;
}

/** The dated hit closest in the text to `at`, so a date is paired with the
 *  keyword (check-in, departure, …) it belongs to. */
function nearestHit(hits: DatedHit[], at: number): DatedHit | null {
  let best: DatedHit | null = null;
  let bestDistance = Infinity;
  for (const hit of hits) {
    const distance = Math.abs(hit.index - at);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = hit;
    }
  }
  return best;
}

/**
 * Heuristic, fully offline extraction for one booking email. Anchors dates to
 * their keywords so a stay becomes one event from check-in to check-out and a
 * flight one event from departure to arrival. Dates are read from the body, not
 * the email's received date.
 */
function extractEvents(message: RawMessage, trip: Trip | null): ExtractedEvent[] {
  const parsed = parseBookingEmail(message);
  if (parsed.handled) {
    return parsed.bookings
      // A booking belongs to the trip when it starts during it; cancellations always apply.
      .filter((booking) => booking.cancelled || !trip || withinWindow(new Date(booking.startAt), trip))
      .map((booking) => ({
        type: booking.type,
        title: booking.title,
        detail: booking.detail,
        date: booking.startAt,
        endDate: booking.endAt,
        bookingRef: booking.bookingRef,
        cancelled: booking.cancelled,
      }));
  }
  return extractEventsHeuristic(message, trip);
}

/** Fallback for emails the structured parser doesn't recognise. */
function extractEventsHeuristic(message: RawMessage, trip: Trip | null): ExtractedEvent[] {
  const body = message.body;
  const context = `${message.sender ?? ""} ${body}`;
  if (INSURANCE.test(body.slice(0, 300))) return [];
  const hits = extractDatedHits(body);
  const inWindow = trip ? hits.filter((hit) => withinWindow(hit.date, trip)) : hits;
  if (inWindow.length === 0) return [];
  inWindow.sort((a, b) => a.date.getTime() - b.date.getTime());

  const provider = matchEmailProvider(body, message.sender);
  const isStay = provider.category === "stays" || isStayEmail(context);
  const isTransit = provider.provider === "flight" || isFlightEmail(context);
  const events: ExtractedEvent[] = [];

  if (isStay) {
    const title =
      hotelNameFromEmail(body) || provider.merchant || merchantFromSender(message.sender) || "Hotel stay";
    const ci = keywordIndex(body, /\bcheck[\s-]?in\b/i);
    const co = keywordIndex(body, /\bcheck[\s-]?out\b/i);
    const checkInHit = ci >= 0 ? nearestHit(inWindow, ci) : inWindow[0];
    const checkOutHit = co >= 0 ? nearestHit(inWindow, co) : inWindow[inWindow.length - 1] ?? null;

    const checkOut =
      checkOutHit && (!checkInHit || checkOutHit.date.getTime() > checkInHit.date.getTime())
        ? applyTime(checkOutHit.date, timeNear(body, checkOutHit.index), 11)
        : undefined;
    if (checkInHit) {
      events.push({
        type: "stay",
        title,
        detail: "",
        date: applyTime(checkInHit.date, timeNear(body, checkInHit.index), 14),
        endDate: checkOut,
      });
    } else if (checkOut) {
      // Only a check-out date: kept as a lone check-out that merges into the stay once it's known.
      events.push({ type: "stay", title, detail: "Check-out", date: checkOut });
    }
    return events;
  }

  if (isTransit) {
    const route = routeDetail(body);
    const title = provider.merchant || merchantFromSender(message.sender) || "Flight";
    const dep = keywordIndex(body, /\b(?:depart(?:ure|s|ing)?|boarding|outbound)\b/i);
    const arr = keywordIndex(body, /\b(?:arriv(?:al|es|ing)?|lands?|inbound)\b/i);
    const depHit = dep >= 0 ? nearestHit(inWindow, dep) : inWindow[0];
    const arrHit = arr >= 0 ? nearestHit(inWindow, arr) : null;

    if (depHit) {
      const departure = applyTime(depHit.date, timeNear(body, depHit.index), 9);
      const arrival = arrHit ? applyTime(arrHit.date, timeNear(body, arrHit.index), 12) : undefined;
      events.push({
        type: "transit",
        title,
        detail: route,
        date: departure,
        endDate: arrival && arrival > departure ? arrival : undefined,
      });
    }
    return events;
  }

  if (ACTIVITY_HINT.test(context)) {
    const hit = inWindow[0];
    events.push({
      type: "activity",
      title: provider.merchant || merchantFromSender(message.sender) || "Activity",
      detail: "",
      date: applyTime(hit.date, timeNear(body, hit.index), 9),
    });
  }

  return events;
}

/**
 * Turns raw booking/confirmation emails into itinerary events: narrows to
 * travel emails for this trip, parses their dates offline, and flags ones
 * already saved so the caller can skip duplicates.
 */
export async function buildEventCandidates(
  messages: RawMessage[],
  source: EventSource,
  options: BuildEventsOptions = {},
): Promise<EventCandidate[]> {
  const { trip } = options;
  const { hasFingerprint, hasExternalId } = useEventsStore.getState();
  const candidates: EventCandidate[] = [];
  const seen = new Set<string>();
  const diagnostics = {
    hinted: 0,
    relevant: 0,
    extracted: 0,
    duplicates: 0,
    rejected: {} as Record<string, number>,
  };

  // Narrow to this trip's travel emails before parsing: a travel keyword plus a
  // destination match.
  const relevant = messages.filter((message) => {
    if (!looksLikeItinerary(message)) {
      diagnostics.rejected["no-itinerary-hint"] = (diagnostics.rejected["no-itinerary-hint"] ?? 0) + 1;
      return false;
    }
    diagnostics.hinted += 1;
    if (trip && !mentionsDestination(message, trip)) {
      diagnostics.rejected["no-destination"] = (diagnostics.rejected["no-destination"] ?? 0) + 1;
      return false;
    }
    return true;
  });
  diagnostics.relevant = relevant.length;

  logger.info("itinerary-import", "scan", {
    messages: messages.length,
    relevant: relevant.length,
    has_trip: Boolean(trip),
  });

  for (const message of relevant) {
    const extracted = extractEvents(message, trip ?? null);
    if (extracted.length === 0) {
      diagnostics.rejected["no-trip-date"] = (diagnostics.rejected["no-trip-date"] ?? 0) + 1;
      continue;
    }
    diagnostics.extracted += extracted.length;

    for (let eventIndex = 0; eventIndex < extracted.length; eventIndex += 1) {
      const event = extracted[eventIndex];
      const startAt = event.date;
      const stored = eventFingerprint({ type: event.type, title: event.title, detail: event.detail, startAt });
      const fingerprint = `${event.cancelled ? "cancel|" : ""}${event.bookingRef ?? ""}|${stored}`;
      const externalId = message.externalId ? `${message.externalId}#${eventIndex}` : undefined;
      // Dedup within the batch by fingerprint, not source id, so the same logical
      // event arriving in two different emails (confirmation + reminder) collapses.
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const duplicate =
        !event.cancelled &&
        (hasFingerprint(stored, trip?.id) || Boolean(externalId && hasExternalId(externalId, trip?.id)));
      if (duplicate) diagnostics.duplicates += 1;

      candidates.push({
        id: externalId ?? fingerprint,
        type: event.type,
        title: event.title,
        detail: event.detail || undefined,
        startAt,
        endAt: event.endDate,
        source,
        rawText: message.body.slice(0, 200),
        note: message.note,
        externalId,
        bookingRef: event.bookingRef,
        cancelled: event.cancelled,
        duplicate,
      });
    }
  }

  logger.info("itinerary-import", "result", {
    hinted: diagnostics.hinted,
    relevant: diagnostics.relevant,
    extracted: diagnostics.extracted,
    duplicates: diagnostics.duplicates,
    candidates: candidates.length,
    fresh: candidates.filter((candidate) => !candidate.duplicate).length,
    ...countAttributes("rejected", diagnostics.rejected),
  });

  return candidates;
}
