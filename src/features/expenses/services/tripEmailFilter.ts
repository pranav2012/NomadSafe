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

function messageMentionsDestination(message: RawMessage, trip: Trip): boolean {
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
