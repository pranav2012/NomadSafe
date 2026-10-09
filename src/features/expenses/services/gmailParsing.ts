import type { ImportErrorCode } from "@/features/expenses/services/importErrors";
import { TRAVEL_MERCHANT_TERMS } from "@/features/expenses/services/tripEmailFilter";

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

const DAY_MS = 86_400_000;
/** Bookings are searched for this many days before the trip starts. */
export const PRE_TRIP_DAYS = 60;

const BOOKING_TERMS = [
  "flight", "airline", "airport", "boarding", '"e-ticket"', "pnr", "train", "rail", "bus", "ferry", "cruise",
  "hotel", "hostel", "resort", "accommodation", '"check-in"', "reservation", "booking", "itinerary", "tour",
  "visa", '"e-visa"', "immigration", "passport",
];
const SPEND_TERMS = ["receipt", "invoice", "payment", "paid", "transaction", "debited", "charged", "purchase", "order", "bill"];
const GENERIC_PLACE_WORDS = new Set(["city", "municipality", "subdistrict", "district"]);

export interface TripMailWindow {
  /** Epoch ms: local midnight `PRE_TRIP_DAYS` before the trip starts. */
  from: number;
  /** Epoch ms: local midnight of the first trip day. */
  tripStart: number;
  /** Epoch ms: local midnight after the last trip day. */
  end: number;
}

function localMidnight(dateKey: string, offsetDays = 0): number | null {
  const [year, month, day] = dateKey.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day + offsetDays).getTime();
}

/** The mail window a trip cares about: bookings before it, spends and bookings during it. */
export function tripMailWindow(trip: { startDate: string; endDate: string }): TripMailWindow | null {
  const tripStart = localMidnight(trip.startDate);
  const end = localMidnight(trip.endDate, 1);
  if (tripStart === null || end === null || end <= tripStart) return null;
  return { from: tripStart - PRE_TRIP_DAYS * DAY_MS, tripStart, end };
}

const stripDiacritics = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Place names to search for, a superset of what the on-device destination filters accept. */
export function destinationSearchTerms(destinations: string[]): string[] {
  const terms = new Set<string>();
  for (const destination of destinations) {
    for (const variant of [destination, stripDiacritics(destination)]) {
      const parts = variant.split(/[,/()\-]+/).map((part) => part.trim().toLowerCase()).filter((part) => part.length >= 3);
      for (const part of parts) {
        terms.add(part);
        for (const token of part.split(/\s+/)) {
          if (token.length >= 4 && !GENERIC_PLACE_WORDS.has(token)) terms.add(token);
        }
      }
    }
  }
  return [...terms];
}

const anyOf = (terms: string[]) => `(${terms.join(" OR ")})`;
const seconds = (ms: number) => Math.floor(ms / 1000);

/**
 * Gmail search for a trip's mail received in [after, before) (epoch ms). Mirrors
 * the on-device trip filter so Gmail returns only candidates: bookings naming a
 * destination before the trip, spends or bookings during it. On a trip at home,
 * spends must also name a destination or a travel company (the on-device rule).
 */
export function buildTripGmailQuery(
  trip: { startDate: string; endDate: string; destinations: string[] },
  after: number,
  before: number,
  options: { domestic?: boolean } = {},
): string | null {
  const window = tripMailWindow(trip);
  if (!window || before <= after) return null;
  const tripStart = seconds(window.tripStart);
  const places = destinationSearchTerms(trip.destinations).map((term) => `"${term.replace(/"/g, "")}"`);
  const clauses: string[] = [];
  if (after < window.tripStart && places.length > 0) {
    clauses.push(`(before:${tripStart} ${anyOf(BOOKING_TERMS)} ${anyOf(places)})`);
  }
  if (before > window.tripStart) {
    if (options.domestic && places.length > 0) {
      const merchants = TRAVEL_MERCHANT_TERMS.map((term) => (/[\s.]/.test(term) ? `"${term}"` : term));
      clauses.push(`(after:${tripStart} (${anyOf(BOOKING_TERMS)} OR (${anyOf(SPEND_TERMS)} ${anyOf([...places, ...merchants])})))`);
    } else {
      clauses.push(`(after:${tripStart} ${anyOf([...BOOKING_TERMS, ...SPEND_TERMS])})`);
    }
  }
  if (clauses.length === 0) return null;
  return [
    "-category:promotions",
    "-category:social",
    `after:${seconds(after)}`,
    `before:${seconds(before)}`,
    clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`,
  ].join(" ");
}

/** Only an invalid token or a missing scope means the grant is dead; quota 403s are rate limits. */
export function gmailErrorCode(status: number, message = ""): ImportErrorCode {
  if (status === 401) return "gmail-auth";
  if (status === 429 || (status === 403 && /rate.?limit|quota/i.test(message))) return "gmail-rate-limit";
  if (status === 403 && /insufficient|scope/i.test(message)) return "gmail-auth";
  return "gmail-api";
}

const MAX_RETRY_DELAY_MS = 32_000;

/** `Retry-After` if given, else exponential backoff with jitter so parallel requests don't retry in lockstep. */
export function gmailRetryDelayMs(attempt: number, retryAfter: string | null, random = Math.random()): number {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS * 2);
  return Math.min(2 ** (attempt + 1) * 1000, MAX_RETRY_DELAY_MS) + Math.floor(random * 1000);
}

export function headerValue(message: GmailMessage, name: string): string | undefined {
  return message.payload?.headers?.find(
    (header) => header.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

// Gmail encodes body data as URL-safe base64. Decode to a UTF-8 string.
export function decodeBase64Url(data: string): string {
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = globalThis.atob(normalized);
    return decodeURIComponent(
      binary
        .split("")
        .map((char) => `%${`00${char.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
  } catch {
    return "";
  }
}

export function decodeQuotedPrintable(value: string): string {
  const binary = value
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  try {
    return decodeURIComponent(
      binary
        .split("")
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  } catch {
    return binary;
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

// Walk the MIME tree, preferring text/plain and falling back to stripped HTML.
export interface GmailAttachment {
  attachmentId: string;
  name: string;
  size: number;
}

/** PDF attachments of a message (booking confirmations, tickets, vouchers). */
export function pdfAttachments(message: GmailMessage): GmailAttachment[] {
  const found: GmailAttachment[] = [];
  const visit = (part?: GmailPart | GmailMessage["payload"]) => {
    if (!part) return;
    const filename = "filename" in part ? part.filename : undefined;
    const attachmentId = part.body && "attachmentId" in part.body ? part.body.attachmentId : undefined;
    if (attachmentId && filename && (part.mimeType === "application/pdf" || /\.pdf$/i.test(filename))) {
      found.push({ attachmentId, name: filename, size: (part.body as { size?: number }).size ?? 0 });
    }
    part.parts?.forEach(visit);
  };
  visit(message.payload);
  return found;
}

export function extractBody(message: GmailMessage): string {
  const plain: string[] = [];
  const html: string[] = [];

  const visit = (part?: GmailPart | GmailMessage["payload"]) => {
    if (!part) return;
    const data = part.body?.data;
    if (data) {
      if (part.mimeType === "text/plain") plain.push(decodeBase64Url(data));
      else if (part.mimeType === "text/html") html.push(stripHtml(decodeQuotedPrintable(decodeBase64Url(data))));
    }
    part.parts?.forEach(visit);
  };

  visit(message.payload);
  return plain.join(" ").trim() || html.join(" ").trim();
}
