import type { BookingLike } from "@/features/itinerary/utils/bookings";
import { tonightStay } from "@/features/itinerary/utils/dayPlan";
import { addDays, fromDateKey } from "@/features/trips/utils/dates";

export interface TripPrep<T> {
  /** The first timed booking (transit or stay), the trip's opening move. */
  first: T | null;
  nights: number;
  bookedNights: number;
  /** Runs of nights with no stay, as [first night, last night]; empty until any stay is booked. */
  gaps: [Date, Date][];
}

/** What's planned before the trip: the first booking and which nights still have nowhere to sleep. */
export function tripPrep<T extends BookingLike>(events: T[], trip: { startDate: string; endDate: string }): TripPrep<T> {
  const start = fromDateKey(trip.startDate);
  const nights = Math.max(0, Math.round((fromDateKey(trip.endDate).getTime() - start.getTime()) / 86_400_000));
  const bookings = events
    .filter((event) => !event.timing && (event.type === "transit" || event.type === "stay"))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const covered = Array.from({ length: nights }, (_, i) => tonightStay(events, addDays(start, i)) !== null);
  const bookedNights = covered.filter(Boolean).length;
  const gaps: [Date, Date][] = [];
  if (bookedNights > 0) {
    let from: number | null = null;
    for (let i = 0; i <= nights; i += 1) {
      const open = i < nights && !covered[i];
      if (open && from === null) from = i;
      if (!open && from !== null) {
        gaps.push([addDays(start, from), addDays(start, i - 1)]);
        from = null;
      }
    }
  }
  return { first: bookings[0] ?? null, nights, bookedNights, gaps };
}
