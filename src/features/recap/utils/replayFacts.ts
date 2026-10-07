import { addDays, fromDateKey, toDateKey } from "@/features/trips/utils/dates";
import { distanceKm, type MapPoint } from "@/features/trips/utils/mapFraming";

/** Days spent at one stop: from the arrival day up to (not counting) the day the next stop starts. */
export interface StopStay {
  from: string;
  /** The next stop's arrival day, or the trip's last day. */
  to: string;
  nights: number;
}

export interface DailySteps {
  date: string;
  steps: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NEAR_KM = 60;

const dayDiff = (from: string, to: string) => Math.round((fromDateKey(to).getTime() - fromDateKey(from).getTime()) / DAY_MS);
const shortName = (name: string) => name.split(",")[0].trim().toLowerCase();

/**
 * When the trip reached each stop and how many nights it stayed. Arrivals come from the transit
 * event covering each leg, else a stay booking that names the city, else the days split evenly.
 */
export function stopSchedule(input: {
  startDate: string;
  endDate: string;
  stops: { name: string }[];
  /** `legDates[i]` is the leg into stop i + 1. */
  legDates: (string | null)[];
  stays: { title: string; detail?: string; startAt: string }[];
}): StopStay[] {
  const { startDate, endDate, stops, legDates, stays } = input;
  const n = stops.length;
  if (n === 0) return [];
  const days = Math.max(1, dayDiff(startDate, endDate) + 1);
  const clampDay = (date: string) => (date < startDate ? startDate : date > endDate ? endDate : date);
  const stayArrival = (name: string) => {
    const needle = shortName(name);
    if (needle.length < 3) return null;
    const found = stays
      .filter((stay) => `${stay.title} ${stay.detail ?? ""}`.toLowerCase().includes(needle))
      .map((stay) => stay.startAt.slice(0, 10))
      .sort();
    return found[0] ?? null;
  };

  const arrivals: string[] = [startDate];
  for (let i = 1; i < n; i += 1) {
    const known = legDates[i - 1] ?? stayArrival(stops[i].name);
    const even = toDateKey(addDays(fromDateKey(startDate), Math.floor((i * days) / n)));
    const day = clampDay(known ?? even);
    arrivals.push(day < arrivals[i - 1] ? arrivals[i - 1] : day);
  }
  return arrivals.map((from, i) => {
    const to = i < n - 1 ? arrivals[i + 1] : endDate;
    return { from, to, nights: Math.max(0, dayDiff(from, to)) };
  });
}

/** The stop the trip was at on `date`: arrival days belong to the new stop; a day either side of the trip still counts. */
export function stopOnDay(schedule: StopStay[], date: string): number | null {
  if (schedule.length === 0) return null;
  const first = schedule[0].from;
  const last = schedule[schedule.length - 1].to;
  if (dayDiff(date, first) > 1 || dayDiff(last, date) > 1) return null;
  let index = 0;
  schedule.forEach((stay, i) => {
    if (stay.from <= date) index = i;
  });
  return index;
}

/** The busiest walking day at each stop (null where none reached `minSteps`). */
export function biggestWalkingDays(daily: DailySteps[], schedule: StopStay[], minSteps = 2000): (DailySteps | null)[] {
  const best: (DailySteps | null)[] = schedule.map(() => null);
  for (const day of daily) {
    const stop = stopOnDay(schedule, day.date);
    if (stop === null || day.steps < minSteps) continue;
    const current = best[stop];
    if (!current || day.steps > current.steps) best[stop] = day;
  }
  return best;
}

interface HighlightEvent {
  type: string;
  title: string;
  startAt: string;
  timing?: string;
  doneAt?: string;
  place?: MapPoint;
}

/**
 * Up to `max` things done at each stop: activities and food from the itinerary (ticked-off ones
 * first), placed by their pin when they have one, else by the day they happened on.
 */
export function stopHighlights(events: HighlightEvent[], stops: MapPoint[], schedule: StopStay[], max = 3): string[][] {
  const byStop: { title: string; done: boolean; food: boolean; at: string }[][] = stops.map(() => []);
  for (const event of events) {
    if (event.type !== "activity" && event.type !== "food") continue;
    if (event.timing === "wishlist" && !event.doneAt) continue;
    const title = event.title.trim();
    if (!title) continue;
    let stop: number | null = null;
    if (event.place) {
      let bestKm = NEAR_KM;
      stops.forEach((point, i) => {
        const km = distanceKm(event.place!, point);
        if (km <= bestKm) {
          bestKm = km;
          stop = i;
        }
      });
    }
    const date = (event.timing === "wishlist" ? event.doneAt : event.startAt)?.slice(0, 10);
    if (stop === null && date) stop = stopOnDay(schedule, date);
    if (stop === null) continue;
    byStop[stop].push({ title, done: Boolean(event.doneAt), food: event.type === "food", at: event.startAt });
  }
  return byStop.map((items) => {
    const seen = new Set<string>();
    return items
      .sort((a, b) => Number(b.done) - Number(a.done) || Number(a.food) - Number(b.food) || a.at.localeCompare(b.at))
      .filter((item) => {
        const key = item.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, max)
      .map((item) => item.title);
  });
}

export interface CountryMilestones {
  firstTime: string[];
  /** Country number in the order first reached (home is #1). */
  numbers: Record<string, number>;
  /** Countries in the whole passport, home included. */
  total: number;
}

/** First visits and lifetime counts for a trip, from the passport's stamps. */
export function countryMilestones(
  stamps: { country: string; date: string; tripId: string | null; pending: boolean }[],
  tripId: string,
  home: string | null,
  tripCountries: string[],
): CountryMilestones {
  const counted = stamps.filter((stamp) => !stamp.pending || stamp.tripId === tripId).sort((a, b) => a.date.localeCompare(b.date));
  const firstStamp = new Map<string, { tripId: string | null; rank: number }>();
  const offset = home ? 1 : 0;
  for (const stamp of counted) {
    if (stamp.country === home || firstStamp.has(stamp.country)) continue;
    firstStamp.set(stamp.country, { tripId: stamp.tripId, rank: firstStamp.size + 1 + offset });
  }
  const firstTime = tripCountries.filter((country) => country !== home && firstStamp.get(country)?.tripId === tripId);
  const numbers: Record<string, number> = {};
  for (const country of firstTime) numbers[country] = firstStamp.get(country)!.rank;
  return { firstTime, numbers, total: firstStamp.size + offset };
}

/** The other people on a trip: shared members other than you, else the companions typed in. */
export function tripCompanions(trip: {
  companions: string[];
  shared?: { myMemberId: string; members: { memberId: string; name: string; status: string }[] };
}): string[] {
  const members = trip.shared?.members.filter((member) => member.status === "active" && member.memberId !== trip.shared!.myMemberId).map((member) => member.name);
  const names = members && members.length > 0 ? members : trip.companions;
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

export type DistanceComparison =
  | { kind: "earthTimes"; times: number }
  | { kind: "earthFraction"; fraction: "tenth" | "quarter" | "third" | "half" | "most" }
  | { kind: "londonNewYork"; count: number }
  | { kind: "londonParis"; count: number }
  | { kind: "marathons"; count: number };

export const EARTH_KM = 40_075;
const LONDON_NEW_YORK_KM = 5_570;
const LONDON_PARIS_KM = 344;
const MARATHON_KM = 42.195;

/** A familiar yardstick for a trip's distance; null when it's too short to bother. */
export function compareDistance(km: number): DistanceComparison | null {
  if (!Number.isFinite(km) || km < 10) return null;
  if (km >= EARTH_KM * 0.95) return { kind: "earthTimes", times: Math.round((km / EARTH_KM) * 10) / 10 };
  if (km >= LONDON_NEW_YORK_KM * 1.8) return { kind: "londonNewYork", count: Math.round(km / LONDON_NEW_YORK_KM) };
  if (km >= 3_500) {
    const share = km / EARTH_KM;
    const steps = [
      { fraction: "tenth", at: 0.1 },
      { fraction: "quarter", at: 0.25 },
      { fraction: "third", at: 1 / 3 },
      { fraction: "half", at: 0.5 },
      { fraction: "most", at: 0.75 },
    ] as const;
    const nearest = steps.reduce((best, step) => (Math.abs(step.at - share) < Math.abs(best.at - share) ? step : best), steps[0]);
    return { kind: "earthFraction", fraction: nearest.fraction };
  }
  if (km >= LONDON_PARIS_KM * 0.9) return { kind: "londonParis", count: Math.max(1, Math.round(km / LONDON_PARIS_KM)) };
  return { kind: "marathons", count: Math.max(1, Math.round(km / MARATHON_KM)) };
}
