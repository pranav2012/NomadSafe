import { addDays, fromDateKey, getTripStatus, startOfLocalDay } from "@/features/trips/utils/dates";

export type HomeStage = "none" | "upcoming" | "eve" | "active" | "ended";

/** Which Home to show: no trip, before it (the day before is "eve"), during or after. */
export function homeStage(trip: { startDate: string; endDate: string } | null | undefined, now: Date): HomeStage {
  if (!trip) return "none";
  const status = getTripStatus(trip, now);
  if (status === "active") return "active";
  if (status === "complete") return "ended";
  return addDays(startOfLocalDay(now), 1) >= fromDateKey(trip.startDate) ? "eve" : "upcoming";
}
