const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parses a "YYYY-MM-DD" key as a local-midnight date (never UTC). */
export function fromDateKey(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function countInclusiveDays(startDate: Date, endDate: Date) {
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1);
}

export type TripStatus = "upcoming" | "active" | "complete";

/** Where a trip sits relative to today, using local calendar days. */
export function getTripStatus(
  trip: { startDate: string; endDate: string },
  now: Date = new Date(),
): TripStatus {
  const today = startOfLocalDay(now);
  if (today < fromDateKey(trip.startDate)) return "upcoming";
  if (today > fromDateKey(trip.endDate)) return "complete";
  return "active";
}
