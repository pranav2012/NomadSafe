import { hotelNameFromEmail, type RawMessage } from "@/features/expenses/services/transactionParser";
import type { EventType, TransitMode } from "@/features/itinerary/constants/eventTypes";

export interface ParsedBooking {
  type: EventType;
  title: string;
  detail: string;
  transitMode?: TransitMode;
  /** Wall-clock time at the place, without a zone ("2026-10-18T15:00:00"), so it reads the same in any time zone. */
  startAt: string;
  endAt?: string;
  bookingRef?: string;
  /** A cancellation: removes the booking with this ref (or title and dates) instead of adding one. */
  cancelled?: boolean;
}

/** `handled`: the email was recognised (booking, cancellation or noise), so the generic fallback must not guess. */
export interface ParseResult {
  handled: boolean;
  bookings: ParsedBooking[];
}

const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAY = "(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+)?";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "18 October 2026", "Sunday, 18 October 2026", "October 18, 2026", "18 Oct", "2026-10-18".
const DATE_SOURCE = `${WEEKDAY}(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?(?:\\s+(\\d{4}))?|${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?|(\\d{4})-(\\d{2})-(\\d{2}))`;
const DATE_AFTER_LABEL = new RegExp(`^[^\\S\\n]*(?:date)?[^\\S\\n]*[:：\\-]?[^\\S\\n]*${DATE_SOURCE}`, "i");
const ANY_DATE = new RegExp(`\\b${DATE_SOURCE}`, "gi");

const NOISE_SUBJECT =
  /^(?:you have a (?:new )?message from|special request for|request sent to|this is your receipt|your (?:hotel )?coupon|.{0,40}account deleted|.{0,30}\bnewsletter\b)/i;
const CANCELLATION = /\b(?:booking|reservation|order)\s+(?:has been\s+|was\s+|is\s+)?cancel+ed\b|\bcancel+ed\s+for\b|\bcancellation confirm/i;
const INSURANCE = /\binsurance\b/i;
const FLIGHT_CONTEXT = /\b(?:flight|airline|airways|e-ticket|boarding|itinerary)\b/i;
const ACTIVITY_DATE = /\b(?:participation|activity|visit|tour|travel|event|ticket)\s+date\b|\bdate of (?:visit|activity)\b/i;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function floatingTime(date: CalendarDate, hour: number, minute: number): string {
  return `${date.year}-${pad(date.month + 1)}-${pad(date.day)}T${pad(hour)}:${pad(minute)}:00`;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(date.year, date.month, date.day + days);
  return { year: next.getFullYear(), month: next.getMonth(), day: next.getDate() };
}

/** Builds a date from regex groups; a missing year is the first one not long before the email. */
function toCalendarDate(match: RegExpMatchArray, offset: number, received: Date): CalendarDate | null {
  const g = (index: number) => match[offset + index];
  let day: number;
  let month: number;
  let year: number | null;
  if (g(7)) {
    year = Number(g(7));
    month = Number(g(8)) - 1;
    day = Number(g(9));
  } else if (g(1)) {
    day = Number(g(1));
    month = MONTHS.indexOf(g(2).slice(0, 3).toLowerCase());
    year = g(3) ? Number(g(3)) : null;
  } else {
    month = MONTHS.indexOf(g(4).slice(0, 3).toLowerCase());
    day = Number(g(5));
    year = g(6) ? Number(g(6)) : null;
  }
  if (month < 0) return null;
  if (year === null) {
    year = received.getFullYear();
    if (new Date(year, month, day).getTime() < received.getTime() - 60 * 86_400_000) year += 1;
  }
  const check = new Date(year, month, day);
  return check.getMonth() === month && check.getDate() === day ? { year, month, day } : null;
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!match || (!match[2] && !match[3])) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** The date written right after a label such as "Check-in", plus the text that follows it. */
function dateAfterLabel(body: string, label: RegExp, received: Date): { date: CalendarDate; rest: string } | null {
  for (const found of body.matchAll(new RegExp(label.source, "gi"))) {
    const after = body.slice((found.index ?? 0) + found[0].length, (found.index ?? 0) + found[0].length + 120);
    const match = after.match(DATE_AFTER_LABEL);
    if (!match) continue;
    const date = toCalendarDate(match, 0, received);
    if (date) return { date, rest: after.slice(match[0].length, match[0].length + 60) };
  }
  return null;
}

/** Check-in "(15:00 - 23:00)" → 15:00; check-out "(until 10:00)" or "(07:00 - 10:00)" → 10:00. */
function timeAfterDate(rest: string, prefer: "first" | "until"): { hour: number; minute: number } | null {
  const bracket = rest.match(/^\s*\(([^)]{0,40})\)/)?.[1] ?? rest.match(/^\s*(?:,|at|from|after|before|by|until)?\s*([^\n]{0,24})/i)?.[1] ?? "";
  if (prefer === "until") {
    const until = bracket.match(/\b(?:until|till|by|before)\s+([\d:.apm ]{1,10})/i);
    if (until) return parseClock(until[1]);
    const range = bracket.match(/[\d:.apm ]+\s*[-–~]\s*([\d:.apm ]+)/i);
    if (range) return parseClock(range[1]);
  }
  return parseClock(bracket);
}

function bookingRef(text: string): string | undefined {
  const pattern = /\b(?:confirmation(?:\s+(?:number|no\.?|code))?|booking\s+(?:number|no\.?|id|reference|ref)|reservation(?:\s+(?:number|no\.?|id|code))?|pnr|booking)\s*[:#]?\s*([A-Z0-9]{6,14})\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (/\d/.test(match[1])) return match[1].toUpperCase();
  }
  return undefined;
}

/** Keeps the Latin name when a property also lists its name in another script. */
function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  const latin = trimmed.replace(/[^\p{Script=Latin}\d\s&'’.,\-()]+/gu, " ").replace(/\s+/g, " ").trim();
  const base = /[A-Za-z]{2}/.test(latin) ? latin : trimmed;
  return base.replace(/[\s.,\-]+$/, "").slice(0, 70).trim();
}

function shortTitle(name: string): string {
  return name.length <= 48 ? name : `${name.slice(0, 48).replace(/\s+\S*$/, "")}…`;
}

function stayName(body: string): string {
  const patterns = [
    /\b(?:confirmed at|updated booking at|booking at|reservation at|cancel+ed for|stay at)\s+(.{2,90}?)(?:\.\s|\s+Booking\.com|\s*$)/i,
    /(?:^|\.\s|\]\s)([A-Z0-9][^.\]\n]{1,80}?)\s+is expecting you\b/,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return cleanName(match[1]);
  }
  return cleanName(hotelNameFromEmail(body));
}

function parseStay(body: string, received: Date, cancelled: boolean): ParsedBooking | null {
  const checkIn = dateAfterLabel(body, /\bcheck[\s-]?in\b/, received);
  const checkOut = dateAfterLabel(body, /\bcheck[\s-]?out\b/, received);
  if (!checkIn) return null;
  const inTime = timeAfterDate(checkIn.rest, "first") ?? { hour: 15, minute: 0 };
  const outTime = checkOut ? (timeAfterDate(checkOut.rest, "until") ?? { hour: 11, minute: 0 }) : null;
  const startAt = floatingTime(checkIn.date, inTime.hour, inTime.minute);
  const endAt = checkOut && outTime ? floatingTime(checkOut.date, outTime.hour, outTime.minute) : undefined;
  return {
    type: "stay",
    title: stayName(body) || "Hotel stay",
    detail: "",
    startAt,
    endAt: endAt && endAt > startAt ? endAt : undefined,
    bookingRef: bookingRef(body),
    cancelled: cancelled || undefined,
  };
}

/** Flight legs such as "JL754 SKY SUITE 02:55 Bengaluru ( Kempegowda Intl ) 14:35 Tokyo (", dated by the nearest date before them. */
function parseFlights(body: string, received: Date): ParsedBooking[] {
  const segment =
    /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b(?:(?!\d{1,2}:\d{2})[^\n]){0,40}?(\d{1,2}:\d{2})\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s*\((?:[^()]|\([^()]*\)){2,60}?\)\s*(\d{1,2}:\d{2})\s+([A-Za-z][A-Za-z .'-]{1,40}?)\s*\(/g;
  const flights: ParsedBooking[] = [];
  const seen = new Set<string>();
  const ref = bookingRef(body);
  for (const leg of body.matchAll(segment)) {
    const index = leg.index ?? 0;
    const before = body.slice(Math.max(0, index - 400), index);
    const dates = [...before.matchAll(ANY_DATE)];
    const last = dates[dates.length - 1];
    const date = last ? toCalendarDate(last, 0, received) : null;
    const departs = parseClock(leg[3]);
    const arrives = parseClock(leg[5]);
    if (!date || !departs || !arrives) continue;
    const number = `${leg[1]}${leg[2]}`;
    const startAt = floatingTime(date, departs.hour, departs.minute);
    const key = `${number}|${startAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const overnight = arrives.hour * 60 + arrives.minute < departs.hour * 60 + departs.minute;
    flights.push({
      type: "transit",
      title: number,
      detail: `${leg[4].trim()} → ${leg[6].trim()}`,
      transitMode: "flight",
      startAt,
      endAt: floatingTime(overnight ? addDays(date, 1) : date, arrives.hour, arrives.minute),
      bookingRef: ref ? `${ref}-${number}` : undefined,
    });
  }
  return flights;
}

function parseActivity(body: string, received: Date): ParsedBooking | null {
  const label = body.match(ACTIVITY_DATE);
  if (!label) return null;
  const found = dateAfterLabel(body, new RegExp(ACTIVITY_DATE.source), received);
  if (!found) return null;
  const time = timeAfterDate(found.rest, "first");
  const name =
    body.match(/\byour booking for\s+(.{3,90}?)(?:\s+(?:has been|is)\s+confirmed|\.\s|\s*$)/i)?.[1] ??
    body.match(/\b(?:booking|order)\s+(?:for|of)\s+(.{3,90}?)(?:\.\s|\s*$)/i)?.[1] ??
    "Activity";
  return {
    type: "activity",
    title: shortTitle(cleanName(name)),
    detail: "",
    startAt: floatingTime(found.date, time?.hour ?? 9, time?.minute ?? 0),
    bookingRef: bookingRef(body),
  };
}

/** Parses stay, flight and ticket confirmations and their cancellations; host messages, receipts and insurance are ignored. */
export function parseBookingEmail(message: RawMessage): ParseResult {
  const body = message.body;
  const head = body.slice(0, 300);
  const received = message.date ? new Date(message.date) : new Date();

  if (NOISE_SUBJECT.test(head) || INSURANCE.test(head)) return { handled: true, bookings: [] };

  const cancelled = CANCELLATION.test(head);
  const stay = parseStay(body, received, cancelled);
  if (stay) return { handled: true, bookings: [stay] };

  if (FLIGHT_CONTEXT.test(body)) {
    const flights = parseFlights(body, received);
    if (flights.length > 0) return { handled: true, bookings: cancelled ? flights.map((f) => ({ ...f, cancelled: true })) : flights };
  }

  const activity = parseActivity(body, received);
  if (activity) return { handled: true, bookings: [{ ...activity, cancelled: cancelled || undefined }] };

  return { handled: cancelled, bookings: [] };
}
