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
  source: EventSource;
  rawText?: string;
  note?: string;
  externalId?: string;
  /** Already present in the itinerary. */
  duplicate: boolean;
}

interface ExtractedEvent {
  type: EventType;
  title: string;
  detail: string;
  date: string;
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

/** Finds all calendar dates in the text along with their position, so a nearby
 *  time can be attached. Handles ISO, "26 Jun 2026", "Jun 26, 2026", and d/m/y. */
function extractDatedHits(text: string): DatedHit[] {
  const hits: DatedHit[] = [];
  const push = (date: Date, index: number) => {
    if (!Number.isNaN(date.getTime())) hits.push({ date, index });
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), m.index ?? 0);
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const month = monthIndex(m[2]);
    if (month != null) push(new Date(Number(m[3]), month, Number(m[1])), m.index ?? 0);
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = monthIndex(m[1]);
    if (month != null) push(new Date(Number(m[3]), month, Number(m[2])), m.index ?? 0);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g)) {
    const year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    push(new Date(year, Number(m[2]) - 1, Number(m[1])), m.index ?? 0);
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
  const start = new Date(`${trip.startDate.slice(0, 10)}T00:00:00`).getTime() - DAY_MS;
  const end = new Date(`${trip.endDate.slice(0, 10)}T00:00:00`).getTime() + DAY_MS;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return day >= start && day <= end;
}

function applyTime(date: Date, time: { hour: number; minute: number } | null, fallbackHour: number): string {
  const result = new Date(date);
  result.setHours(time?.hour ?? fallbackHour, time?.minute ?? 0, 0, 0);
  return result.toISOString();
}

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

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Heuristic, fully offline extraction for one booking email. Anchors each event
 * to its keyword so a multi-night stay yields only a check-in and a check-out
 * (not one per night), and a flight yields a departure and an arrival. Dates are
 * read from the body, not the email's received date.
 */
function extractEvents(message: RawMessage, trip: Trip | null): ExtractedEvent[] {
  const body = message.body;
  const context = `${message.sender ?? ""} ${body}`;
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

    if (checkInHit) {
      events.push({
        type: "stay",
        title,
        detail: "Check-in",
        date: applyTime(checkInHit.date, timeNear(body, checkInHit.index), 14),
      });
    }
    if (checkOutHit && (co >= 0 || !checkInHit || dayKey(checkOutHit.date) !== dayKey(checkInHit.date))) {
      events.push({
        type: "stay",
        title,
        detail: "Check-out",
        date: applyTime(checkOutHit.date, timeNear(body, checkOutHit.index), 11),
      });
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
      events.push({
        type: "transit",
        title,
        detail: route ? `Departure · ${route}` : "Departure",
        date: applyTime(depHit.date, timeNear(body, depHit.index), 9),
      });
    }
    if (arrHit) {
      events.push({
        type: "transit",
        title,
        detail: route ? `Arrival · ${route}` : "Arrival",
        date: applyTime(arrHit.date, timeNear(body, arrHit.index), 12),
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

  console.info("[itinerary-import] scan", {
    messages: messages.length,
    relevant: relevant.length,
    trip: trip ? { id: trip.id, startDate: trip.startDate, endDate: trip.endDate } : null,
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
      const fingerprint = eventFingerprint({
        type: event.type,
        title: event.title,
        detail: event.detail,
        startAt,
      });
      const externalId = message.externalId ? `${message.externalId}#${eventIndex}` : undefined;
      // Dedup within the batch by fingerprint, not source id, so the same logical
      // event arriving in two different emails (confirmation + reminder) collapses.
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const duplicate =
        hasFingerprint(fingerprint) || Boolean(externalId && hasExternalId(externalId));
      if (duplicate) diagnostics.duplicates += 1;

      candidates.push({
        id: externalId ?? fingerprint,
        type: event.type,
        title: event.title,
        detail: event.detail || undefined,
        startAt,
        source,
        rawText: message.body.slice(0, 200),
        note: message.note,
        externalId,
        duplicate,
      });
    }
  }

  console.info("[itinerary-import] result", {
    ...diagnostics,
    candidates: candidates.length,
    fresh: candidates.filter((candidate) => !candidate.duplicate).length,
  });

  return candidates;
}
