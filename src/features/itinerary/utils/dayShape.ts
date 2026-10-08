import type { EventType } from "@/features/itinerary/constants/eventTypes";
import { DEFAULT_MEAL_WINDOWS, countryMealWindows, type MealWindow, type MealWindows } from "@/features/itinerary/data/mealTimes";
import { airportCoordinates, airportCountry } from "@/features/itinerary/utils/airports";
import type { BookingLike } from "@/features/itinerary/utils/bookings";
import { entriesOnDay, tonightStay } from "@/features/itinerary/utils/dayPlan";
import { isForMe } from "@/features/itinerary/utils/people";
import type { TimelineEntry } from "@/features/itinerary/utils/timeline";
import type { TravelDetails } from "@/features/itinerary/utils/travelDetails";
import { parseRouteEnds, transitModeOf } from "@/features/itinerary/utils/transit";
import { distanceKm, type MapPoint } from "@/features/trips/utils/mapFraming";

export type Meal = "lunch" | "dinner";
export type MoveMode = "walk" | "transit" | "drive";
export type MissingKind = "place" | "ticket";

export interface PlacedEvent extends BookingLike {
  id: string;
  place?: MapPoint & { name?: string };
  ticketHolders?: string[];
  travel?: TravelDetails;
}

export interface MoveEstimate {
  km: number;
  minutes: number;
  mode: MoveMode;
}

export interface DurationGuess {
  minutes: number;
  estimated: boolean;
}

export interface DayItem<T extends PlacedEvent> {
  entry: TimelineEntry<T>;
  key: string;
  start: number;
  end: number;
  duration: DurationGuess | null;
}

export type DayGap =
  | { kind: "exit"; minutes: number; international: boolean }
  | { kind: "board"; minutes: number; flight: boolean }
  | { kind: "move"; estimate: MoveEstimate; tight: boolean }
  | { kind: "free"; from: number; to: number; minutes: number; meal?: Meal; near: MapPoint | null; bags: boolean };

export interface DayShape<T extends PlacedEvent> {
  items: DayItem<T>[];
  before: DayGap[];
  after: Record<string, DayGap[]>;
  km: number;
  busyMinutes: number;
  freeMinutes: number;
  openMeals: Meal[];
}

const MIN = 60_000;
const DETOUR = 1.3;
const WALK_KM = 1.5;
const WALK_KMH = 4.8;
const TRANSIT_KMH = 18;
const TRANSIT_WAIT_MIN = 10;
const DRIVE_FROM_KM = 25;
const DRIVE_KMH = 50;
const SAME_PLACE_KM = 0.08;
// Median landing-to-kerb times (Blacklane pickups: 23 min domestic, 38 international), rounded up for bags.
const EXIT_DOMESTIC_MIN = 25;
const EXIT_INTERNATIONAL_MIN = 45;
const BOARD_FLIGHT_DOMESTIC_MIN = 75;
const BOARD_FLIGHT_INTERNATIONAL_MIN = 120;
const BOARD_GROUND_MIN = 15;
const SLACK_MIN = 15;
const FREE_MIN = 60;
const MEAL_MIN = 45;
const BAGS_MIN = 120;
const DAY_FROM_MIN = 8 * 60;
const DAY_TO_MIN = 23 * 60;
const AWAKE_MIN = 12 * 60;
const MEAL_REACH_BEFORE_MIN = 90;
const MEAL_REACH_AFTER_MIN = 60;
const LEARN_MIN_SAMPLES = 3;

const DEFAULT_MINUTES: Record<EventType, number> = { activity: 120, food: 75, transit: 60, stay: 0, note: 0 };

// Typical visit lengths by what the item is; museums average ~2 h for a whole visit (NHMU stay-time study).
const KIND_MINUTES: [RegExp, number][] = [
  [/\b(?:day trip|excursion|safari|full[- ]day|tour)\b/i, 240],
  [/\b(?:class|workshop|cooking|course)\b/i, 180],
  [/\b(?:show|concert|theat(?:re|er)|musical|opera|match|game)\b/i, 150],
  [/\b(?:spa|massage|onsen|hammam)\b/i, 90],
  [/\b(?:dinner)\b/i, 90],
  [/\b(?:lunch|brunch)\b/i, 60],
  [/\b(?:breakfast|coffee|caf[eé]|tea|bakery|drinks?)\b/i, 45],
];

const TICKET_HINT = /\b(?:tickets?|admission|entry|tour|museum|show|concert|class|workshop|cruise|tower|observatory|park|experience|pass)\b/i;

const time = (value: string) => new Date(value).getTime();
const keyOf = (entry: TimelineEntry<PlacedEvent>) => `${entry.event.id}-${entry.role}`;
const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
const minutesOfDay = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
};
const roundTo5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);

/** Rough door-to-door time between two places from the straight-line distance: walk, local transit, or drive. */
export function estimateMove(from: MapPoint | null, to: MapPoint | null): MoveEstimate | null {
  if (!from || !to) return null;
  const km = distanceKm(from, to) * DETOUR;
  if (km < SAME_PLACE_KM) return null;
  if (km <= WALK_KM) return { km, minutes: roundTo5((km / WALK_KMH) * 60), mode: "walk" };
  if (km < DRIVE_FROM_KM) return { km, minutes: roundTo5(TRANSIT_WAIT_MIN + (km / TRANSIT_KMH) * 60), mode: "transit" };
  return { km, minutes: roundTo5((km / DRIVE_KMH) * 60), mode: "drive" };
}

/** Median length per type from this trip's items that have an end time, once there are a few. */
export function learnedMinutes(events: BookingLike[]): Partial<Record<EventType, number>> {
  const samples = new Map<EventType, number[]>();
  for (const event of events) {
    if (!event.endAt || event.timing || (event.type !== "activity" && event.type !== "food")) continue;
    const minutes = (time(event.endAt) - time(event.startAt)) / MIN;
    if (minutes <= 0 || minutes > 12 * 60) continue;
    samples.set(event.type, [...(samples.get(event.type) ?? []), minutes]);
  }
  const learned: Partial<Record<EventType, number>> = {};
  for (const [type, values] of samples) {
    if (values.length < LEARN_MIN_SAMPLES) continue;
    const sorted = [...values].sort((a, b) => a - b);
    learned[type] = roundTo5(sorted[Math.floor(sorted.length / 2)]);
  }
  return learned;
}

/** How long a single item takes: its own end time, else what the title suggests, else the trip's usual, else a default. */
export function itemMinutes(event: BookingLike, learned: Partial<Record<EventType, number>> = {}): DurationGuess {
  if (event.endAt) return { minutes: Math.max(0, (time(event.endAt) - time(event.startAt)) / MIN), estimated: false };
  if (event.type === "note" || event.type === "stay") return { minutes: 0, estimated: false };
  const text = `${event.title} ${event.detail ?? ""}`;
  const byKind = event.type === "transit" ? undefined : KIND_MINUTES.find(([pattern]) => pattern.test(text))?.[1];
  return { minutes: byKind ?? learned[event.type] ?? DEFAULT_MINUTES[event.type], estimated: true };
}

/**
 * Lunch and dinner windows for the place, shifted to the trip's own habit: when at least two meals
 * are planned in a band, the window centres on their median start and keeps its length.
 */
export function mealWindowsFor(country: string | null | undefined, events: BookingLike[]): MealWindows {
  const base = country ? countryMealWindows(country) : DEFAULT_MEAL_WINDOWS;
  const starts = events.filter((event) => event.type === "food" && !event.timing && isForMe(event)).map((event) => minutesOfDay(time(event.startAt)));
  const shift = (window: MealWindow, from: number, to: number): MealWindow => {
    const band = starts.filter((minute) => minute >= from && minute < to).sort((a, b) => a - b);
    if (band.length < 2) return window;
    const median = band[Math.floor(band.length / 2)];
    const half = (window[1] - window[0]) / 2;
    return [Math.round(median - half), Math.round(median + half)];
  };
  return { lunch: shift(base.lunch, 11 * 60, 16 * 60), dinner: shift(base.dinner, 17 * 60, 24 * 60) };
}

function flightEnds(event: BookingLike): [string, string] | null {
  const ends = parseRouteEnds(event.detail) ?? parseRouteEnds(event.title);
  return ends && /^[A-Z]{3}$/.test(ends[0]) && /^[A-Z]{3}$/.test(ends[1]) ? ends : null;
}

/** Where an item begins and ends: flights use their airports, other transit only knows where it arrives. */
export function endpoints(event: PlacedEvent): { start: MapPoint | null; end: MapPoint | null } {
  const place = event.place ?? null;
  if (event.type !== "transit") return { start: place, end: place };
  const ends = transitModeOf(event) === "flight" ? flightEnds(event) : null;
  if (ends) return { start: airportCoordinates(ends[0]), end: airportCoordinates(ends[1]) ?? place };
  return { start: null, end: place };
}

function isInternationalFlight(event: BookingLike, homeCountry: string | null | undefined): boolean {
  const ends = flightEnds(event);
  if (!ends) return true;
  const from = airportCountry(ends[0]);
  const to = airportCountry(ends[1]);
  if (!from || !to) return Boolean(homeCountry) && to !== homeCountry;
  return from !== to;
}

/** Timed moments on `day` with overnight transit landing that day added as "arrival" entries. */
export function dayEntries<T extends PlacedEvent>(events: T[], day: Date): TimelineEntry<T>[] {
  const from = startOfDay(day).getTime();
  const to = from + 86_400_000;
  const arrivals: TimelineEntry<T>[] = events
    .filter((event) => event.type === "transit" && !event.timing && event.endAt && time(event.startAt) < from && time(event.endAt) >= from && time(event.endAt) < to)
    .map((event) => ({ event, at: event.endAt!, role: "arrival" }));
  return [...arrivals, ...entriesOnDay(events, day).filter((entry) => !entry.event.timing)].sort((a, b) => time(a.at) - time(b.at));
}

/** Whether an item usually needs a ticket at the door and none is saved for it. */
export function missingInfo(event: PlacedEvent, context: { hasTicket: boolean; placeFailed: boolean }): MissingKind[] {
  const missing: MissingKind[] = [];
  const placeable = event.type === "activity" || event.type === "food" || event.type === "stay";
  if (placeable && !event.place && context.placeFailed) missing.push("place");
  const othersHold = (event.ticketHolders ?? []).length > 0;
  const mode = transitModeOf(event);
  const needsTicket =
    event.type === "transit"
      ? mode !== undefined && mode !== "car"
      : event.type === "activity" && (event.source === "email" || Boolean(event.bookingRef) || TICKET_HINT.test(`${event.title} ${event.detail ?? ""}`));
  if (needsTicket && !context.hasTicket && !othersHold && !event.timing) missing.push("ticket");
  return missing;
}

interface Open {
  from: number;
  to: number;
  after: string | null;
  near: MapPoint | null;
  between: boolean;
  bags: boolean;
}

/**
 * The shape of one day of your plan: how long each item takes, getting out of the airport, being at
 * the station or airport in time, moving between places, free windows of an hour or more, and lunch
 * or dinner when nothing is planned for it. `entries` are your timed entries for the day, in order.
 */
export function dayShape<T extends PlacedEvent>(
  entries: TimelineEntry<T>[],
  options: { day: Date; meals: MealWindows; learned?: Partial<Record<EventType, number>>; homeCountry?: string | null },
): DayShape<T> {
  const dayStart = startOfDay(options.day).getTime();
  const items: DayItem<T>[] = entries.map((entry) => {
    const start = time(entry.at);
    if (entry.role !== "single") return { entry, key: keyOf(entry), start, end: start, duration: null };
    const duration = itemMinutes(entry.event, options.learned);
    return { entry, key: keyOf(entry), start, end: start + duration.minutes * MIN, duration: entry.event.type === "note" ? null : duration };
  });

  const after: Record<string, DayGap[]> = {};
  const before: DayGap[] = [];
  const opens: Open[] = [];
  let km = 0;
  let busy = 0;

  const isFlight = (event: BookingLike) => event.type === "transit" && transitModeOf(event) === "flight";
  const lands = (item: DayItem<T>) => item.entry.event.type === "transit" && (item.entry.role === "arrival" || (item.entry.role === "single" && item.entry.event.endAt));
  const departs = (item: DayItem<T>) => item.entry.event.type === "transit" && item.entry.role === "single";
  const readyAt = (item: DayItem<T>) => {
    if (item.entry.role === "arrival") return item.start;
    return item.end;
  };

  for (const item of items) {
    if (item.entry.role === "single" && item.entry.event.type !== "note") busy += Math.max(0, item.end - item.start) / MIN;
  }

  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    const b = items[i + 1];
    const gaps: DayGap[] = [];
    let ready = readyAt(a);
    if (lands(a) && isFlight(a.entry.event)) {
      const international = isInternationalFlight(a.entry.event, options.homeCountry);
      const minutes = international ? EXIT_INTERNATIONAL_MIN : EXIT_DOMESTIC_MIN;
      gaps.push({ kind: "exit", minutes, international });
      ready += minutes * MIN;
    }
    const here = a.entry.role === "single" || a.entry.role === "arrival" ? endpoints(a.entry.event).end : endpoints(a.entry.event).start;
    if (!b) {
      if (!departs(a) || a.entry.role === "arrival") opens.push({ from: ready, to: dayStart + DAY_TO_MIN * MIN, after: a.key, near: here, between: false, bags: false });
      if (gaps.length > 0) after[a.key] = gaps;
      break;
    }

    let leaveBy = b.start;
    if (departs(b)) {
      const flight = isFlight(b.entry.event);
      const minutes = flight ? (isInternationalFlight(b.entry.event, options.homeCountry) ? BOARD_FLIGHT_INTERNATIONAL_MIN : BOARD_FLIGHT_DOMESTIC_MIN) : BOARD_GROUND_MIN;
      leaveBy -= minutes * MIN;
      gaps.push({ kind: "board", minutes, flight });
    }
    const move = estimateMove(here, endpoints(b.entry.event).start);
    if (move) {
      km += move.km;
      const tight = !a.duration?.estimated && leaveBy - ready < move.minutes * MIN;
      gaps.splice(gaps[gaps.length - 1]?.kind === "board" ? gaps.length - 1 : gaps.length, 0, { kind: "move", estimate: move, tight });
      leaveBy -= move.minutes * MIN;
    }
    const bags = Boolean(lands(a)) && b.entry.role === "check-in";
    opens.push({ from: ready, to: leaveBy - SLACK_MIN * MIN, after: a.key, near: here ?? endpoints(b.entry.event).start, between: true, bags });
    after[a.key] = gaps;
  }

  const first = items[0];
  if (first && !departs(first) && first.entry.role !== "arrival") {
    const firstPlace = endpoints(first.entry.event).start;
    opens.unshift({ from: dayStart + DAY_FROM_MIN * MIN, to: first.start - SLACK_MIN * MIN, after: null, near: firstPlace, between: false, bags: false });
  }

  const foodStarts = items.filter((item) => item.entry.event.type === "food" && item.entry.role === "single").map((item) => item.start);
  const mealOf = new Map<Open, { meal: Meal; from: number; to: number }>();
  const openMeals: Meal[] = [];
  for (const meal of ["lunch", "dinner"] as const) {
    const [from, to] = options.meals[meal].map((minute) => dayStart + minute * MIN);
    if (foodStarts.some((start) => start >= from - MEAL_REACH_BEFORE_MIN * MIN && start <= to + MEAL_REACH_AFTER_MIN * MIN)) continue;
    let best: { open: Open; from: number; to: number } | null = null;
    for (const open of opens) {
      const overlapFrom = Math.max(open.from, from);
      const overlapTo = Math.min(open.to, to);
      if (overlapTo - overlapFrom < MEAL_MIN * MIN || mealOf.has(open)) continue;
      if (!best || overlapTo - overlapFrom > best.to - best.from) best = { open, from: overlapFrom, to: overlapTo };
    }
    if (!best) continue;
    mealOf.set(best.open, { meal, from: best.from, to: best.to });
    openMeals.push(meal);
  }

  let freeMinutes = 0;
  for (const open of opens) {
    const meal = mealOf.get(open);
    const minutes = (open.to - open.from) / MIN;
    if (!meal && (!open.between || minutes < FREE_MIN)) continue;
    const gap: DayGap = meal
      ? { kind: "free", from: open.between ? open.from : meal.from, to: open.between ? open.to : meal.to, minutes: open.between ? minutes : (meal.to - meal.from) / MIN, meal: meal.meal, near: open.near, bags: open.bags && minutes >= BAGS_MIN }
      : { kind: "free", from: open.from, to: open.to, minutes, near: open.near, bags: open.bags && minutes >= BAGS_MIN };
    if (open.between) freeMinutes += minutes;
    if (open.after === null) before.push(gap);
    else (after[open.after] ??= []).push(gap);
  }

  return { items, before, after, km, busyMinutes: Math.round(busy), freeMinutes: Math.round(freeMinutes), openMeals };
}

export interface GlanceDay<T extends PlacedEvent> {
  date: Date;
  items: T[];
  arrival: { event: T; at: number } | null;
  departure: { event: T; at: number } | null;
  tonight: T | null;
  /** A night of the trip (not the last day) with no stay booked. */
  needsStay: boolean;
  km: number;
  busyMinutes: number;
  freeMinutes: number;
  /** Share of a 12-hour waking day that's planned, 0..1. */
  load: number;
  openMeals: Meal[];
  missing: number;
}

/** One summary row per trip day for "Trip at a glance": arrivals, the stay, how full the day is and what's missing. */
export function tripGlance<T extends PlacedEvent>(
  events: T[],
  days: Date[],
  options: {
    mealsOn: (day: Date) => MealWindows;
    learned?: Partial<Record<EventType, number>>;
    homeCountry?: string | null;
    missingOf: (event: T) => MissingKind[];
  },
): GlanceDay<T>[] {
  const mine = events.filter(isForMe);
  return days.map((date, index) => {
    const entries = dayEntries(mine, date);
    const shape = dayShape(entries, { day: date, meals: options.mealsOn(date), learned: options.learned, homeCountry: options.homeCountry });
    const anytime = mine.filter((event) => event.timing === "anytime" && startOfDay(new Date(event.startAt)).getTime() === startOfDay(date).getTime());
    const items = [...new Map([...entries.map((entry) => entry.event), ...anytime].map((event) => [event.id, event])).values()];
    const transits = entries.filter((entry) => entry.event.type === "transit");
    const landing = transits
      .map((entry) => ({ event: entry.event, at: entry.role === "arrival" ? time(entry.at) : entry.event.endAt ? time(entry.event.endAt) : NaN }))
      .filter((item) => Number.isFinite(item.at) && startOfDay(new Date(item.at)).getTime() === startOfDay(date).getTime());
    const leaving = transits.filter((entry) => entry.role === "single").map((entry) => ({ event: entry.event, at: time(entry.at) }));
    const tonight = tonightStay(mine, date)?.event ?? null;
    const lastDay = index === days.length - 1;
    const sleepsAway = leaving.some((item) => item.event.endAt && startOfDay(new Date(item.event.endAt)).getTime() > startOfDay(date).getTime());
    return {
      date,
      items,
      arrival: landing[0] ?? null,
      departure: leaving[leaving.length - 1] ?? null,
      tonight,
      needsStay: !lastDay && !tonight && !sleepsAway,
      km: shape.km,
      busyMinutes: shape.busyMinutes,
      freeMinutes: shape.freeMinutes,
      load: Math.min(1, shape.busyMinutes / AWAKE_MIN),
      openMeals: shape.openMeals,
      missing: items.reduce((sum, event) => sum + options.missingOf(event).length, 0),
    };
  });
}

export interface TravelPlan {
  departAt: number;
  /** How early to be at the airport, station or pier. */
  beThereMinutes: number;
  /** Getting there from where you'll be before (the previous item, else last night's stay). */
  move: MoveEstimate | null;
  leaveAt: number;
  boardingAt: number | null;
  boardingEstimated: boolean;
}

const BOARDING_BEFORE_MIN: Partial<Record<string, number>> = { flight: 40, ferry: 20 };

/** When to leave for a departure and when boarding starts: from the booking when it says, else typical buffers and the travel estimate. */
export function travelPlan<T extends PlacedEvent>(events: T[], transit: T, homeCountry?: string | null): TravelPlan {
  const departAt = time(transit.startAt);
  const mode = transitModeOf(transit);
  const flight = mode === "flight";
  const beThereMinutes = flight ? (isInternationalFlight(transit, homeCountry) ? BOARD_FLIGHT_INTERNATIONAL_MIN : BOARD_FLIGHT_DOMESTIC_MIN) : BOARD_GROUND_MIN;
  const day = startOfDay(new Date(departAt));
  const mine = events.filter(isForMe);
  const before = dayEntries(mine, day).filter((entry) => entry.event.id !== transit.id && time(entry.at) <= departAt);
  const previous = [...before].reverse().find((entry) => (entry.role === "single" ? endpoints(entry.event).end : entry.event.place));
  const from = previous
    ? previous.role === "single"
      ? endpoints(previous.event).end
      : (previous.event.place ?? null)
    : (tonightStay(mine, new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1))?.event.place ?? null);
  const move = estimateMove(from, endpoints(transit).start);
  const boardingAt = transit.travel?.boardingAt
    ? time(transit.travel.boardingAt)
    : mode && BOARDING_BEFORE_MIN[mode] !== undefined
      ? departAt - BOARDING_BEFORE_MIN[mode]! * MIN
      : null;
  return {
    departAt,
    beThereMinutes,
    move,
    leaveAt: departAt - (beThereMinutes + (move?.minutes ?? 0)) * MIN,
    boardingAt,
    boardingEstimated: !transit.travel?.boardingAt,
  };
}
