import type { RawMessage } from "@/features/expenses/services/transactionParser";
import type { Trip } from "@/features/trips/store/tripsStore";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";

export type TripMatchRejection =
  | "invalid-email-date"
  | "after-trip"
  | "pretrip-not-booking"
  | "pretrip-destination-mismatch";

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function messageMentionsDestination(message: RawMessage, trip: Pick<Trip, "destinations">): boolean {
  const email = normalizedText([message.body, message.sender].filter(Boolean).join(" "));
  return trip.destinations.some((destination) => {
    const destinationParts = normalizedText(destination)
      .split(/[,/()\-]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3);
    const meaningfulTokens = destinationParts.flatMap((part) =>
      part
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !["city", "municipality", "subdistrict"].includes(token)),
    );
    return [...destinationParts, ...meaningfulTokens].some((part) => email.includes(part));
  });
}

function messageDateKey(message: RawMessage): string | null {
  if (!message.date || Number.isNaN(new Date(message.date).getTime())) return null;
  return toLocalDayKey(message.date);
}

export function isPreTripBooking(message: RawMessage): boolean {
  return /\b(?:flight|airline|airport|boarding|hotel|hostel|resort|accommodation|check[- ]?in|reservation|booking|visa|e-visa|immigration|consulate|passport)\b/i.test(
    [message.body, message.sender].filter(Boolean).join(" "),
  );
}

/**
 * Null when the email belongs to the trip: received during it, or a booking
 * made before it that names one of its destinations. Otherwise the reason.
 */
export function tripMatchReason(message: RawMessage, trip: Trip): TripMatchRejection | null {
  const date = messageDateKey(message);
  const startDate = trip.startDate.slice(0, 10);
  const endDate = trip.endDate.slice(0, 10);
  if (!date) return "invalid-email-date";
  if (date > endDate) return "after-trip";

  if (date >= startDate) return null;

  if (!isPreTripBooking(message)) return "pretrip-not-booking";
  return messageMentionsDestination(message, trip) ? null : "pretrip-destination-mismatch";
}

export type TripSpendRejection = "spend-not-trip";

/** What a spend email during the trip is checked against. */
export interface TripSpendContext {
  /** Currencies of the destination countries (ISO 4217). */
  localCurrencies: string[];
  /** Every destination is in the user's home country, so the currency says nothing. */
  domestic: boolean;
}

/** Airlines, stays and booking sites, rail and coaches, ride-hailing and car hire; also used as Gmail search terms. */
export const TRAVEL_MERCHANT_TERMS = [
  "airline", "airlines", "airways", "air india", "indigo", "vistara", "spicejet", "akasa", "emirates", "etihad",
  "qatar airways", "singapore airlines", "lufthansa", "british airways", "air france", "klm", "ryanair", "easyjet",
  "airasia", "vietjet", "thai airways", "cathay", "jetstar", "scoot", "turkish airlines", "united airlines", "delta air",
  "american airlines", "qantas", "wizz", "vueling", "agoda", "booking.com", "airbnb", "expedia", "hotels.com",
  "trip.com", "makemytrip", "goibibo", "cleartrip", "yatra", "easemytrip", "ixigo", "hostelworld", "klook",
  "getyourguide", "viator", "kiwi.com", "traveloka", "marriott", "hilton", "hyatt", "ihg", "accor", "radisson",
  "oyo", "irctc", "redbus", "trainline", "eurail", "interrail", "amtrak", "sncf", "renfe", "trenitalia",
  "deutsche bahn", "flixbus", "12go", "uber", "grab", "bolt", "lyft", "gojek", "careem", "didi", "hertz", "avis",
  "sixt", "europcar", "zoomcar",
];

// Food and grocery delivery from ride-hailing brands is everyday spending, not travel.
const NOT_TRAVEL = /\b(?:uber\s?eats|grab\s?food|grab\s?mart|bolt\s?food|gofood)\b/i;
const escapeTerm = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s?");
const TRAVEL_MERCHANT = new RegExp(`(?:^|[^a-z0-9])(?:${TRAVEL_MERCHANT_TERMS.map(escapeTerm).join("|")})(?![a-z0-9])`, "i");

/** True when the sender, merchant or subject names a travel company. */
export function isTravelMerchant(message: Pick<RawMessage, "sender" | "body">, merchant?: string): boolean {
  const head = [message.sender, merchant, message.body.slice(0, 160)].filter(Boolean).join(" ");
  return !NOT_TRAVEL.test(head) && TRAVEL_MERCHANT.test(head);
}

/** Destination currencies and whether the trip is at home, from the destinations' countries. */
export function tripSpendContext(
  countries: string[],
  home: string | null,
  currencyOf: (country: string) => string | null | undefined,
): TripSpendContext {
  const unique = [...new Set(countries.map((country) => country.toUpperCase()))];
  const domestic = Boolean(home) && unique.length > 0 && unique.every((country) => country === home?.toUpperCase());
  const localCurrencies = domestic
    ? []
    : [...new Set(unique.map(currencyOf).filter((code): code is string => Boolean(code)).map((code) => code.toUpperCase()))];
  return { localCurrencies, domestic };
}

/**
 * Null when a spend received during the trip belongs to it: it names a destination, is in a
 * destination's currency (trips abroad only) or comes from a travel company. Bills, food orders and
 * bank alerts from home are dropped. Mail before the trip is left to `tripMatchReason`.
 */
export function tripSpendReason(
  message: RawMessage,
  trip: Pick<Trip, "destinations" | "startDate">,
  spend: { currency: string; merchant?: string },
  context: TripSpendContext,
): TripSpendRejection | null {
  const date = messageDateKey(message);
  if (!date || date < trip.startDate.slice(0, 10)) return null;
  if (messageMentionsDestination(message, trip)) return null;
  if (isTravelMerchant(message, spend.merchant)) return null;
  if (!context.domestic && context.localCurrencies.includes(spend.currency.toUpperCase())) return null;
  return "spend-not-trip";
}
