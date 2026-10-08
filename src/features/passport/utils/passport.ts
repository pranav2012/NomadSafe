import type { TripStatus } from "@/features/trips/utils/dates";
import { dateTimeFormat } from "@/utils/intl";

export interface PassportTrip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  days: number;
  status: TripStatus;
  /** In trip order; country and region are null where a stop couldn't be placed. */
  stops: { name: string; country: string | null; region: string | null }[];
}

export interface PassportPast {
  id: string;
  country: string;
  region: string | null;
  place: string | null;
  year: number;
  month: number | null;
}

export interface Stamp {
  id: string;
  country: string;
  /** "YYYY-MM-DD" for trips, "YYYY-MM" or "YYYY" for past travel. */
  date: string;
  /** Where the trip entered the country (its first stop there). */
  place: string | null;
  tripId: string | null;
  pastId: string | null;
  /** Completed through the app, rather than added from memory. */
  viaApp: boolean;
  /** An upcoming or running trip: shown as an outline until it ends. */
  pending: boolean;
}

export interface Seal {
  region: string;
  visits: number;
  /** Earliest visit, same format as `Stamp.date`. */
  first: string;
  viaApp: boolean;
}

export interface Passport {
  home: string | null;
  /** International stamps, oldest first; pending ones last. */
  stamps: Stamp[];
  /** States visited at home, most visited first. */
  seals: Seal[];
  countries: number;
  continents: number;
  daysAbroad: number;
  latest: Stamp | null;
}

const pastDate = (past: PassportPast) => (past.month ? `${past.year}-${String(past.month).padStart(2, "0")}` : String(past.year));

/**
 * Works the passport out from trips and past travel. Countries other than `home` become stamps (one
 * per country per trip, like a real passport); stops at home become state seals with a visit count.
 */
export function buildPassport(input: { trips: PassportTrip[]; past: PassportPast[]; home: string | null; continentOf: (country: string) => string | null }): Passport {
  const { trips, past, home, continentOf } = input;
  const stamps: Stamp[] = [];
  const seals = new Map<string, Seal>();
  const visited = new Set<string>();
  let daysAbroad = 0;

  const addSeal = (region: string, date: string, viaApp: boolean) => {
    const seal = seals.get(region);
    if (!seal) {
      seals.set(region, { region, visits: 1, first: date, viaApp });
      return;
    }
    seal.visits += 1;
    if (date < seal.first) seal.first = date;
    seal.viaApp ||= viaApp;
  };

  for (const trip of trips) {
    const pending = trip.status !== "complete";
    const countries = new Map<string, string>();
    const regions = new Set<string>();
    for (const stop of trip.stops) {
      if (!stop.country) continue;
      if (stop.country === home) {
        if (stop.region) regions.add(stop.region);
        continue;
      }
      if (!countries.has(stop.country)) countries.set(stop.country, stop.name);
    }
    for (const [country, place] of countries) {
      stamps.push({ id: `${trip.id}:${country}`, country, date: trip.startDate, place, tripId: trip.id, pastId: null, viaApp: true, pending });
    }
    if (pending) continue;
    for (const region of regions) addSeal(region, trip.startDate, true);
    for (const country of countries.keys()) visited.add(country);
    if (home && trip.stops.some((stop) => stop.country === home)) visited.add(home);
    if (countries.size > 0) daysAbroad += trip.days;
  }

  for (const entry of past) {
    const date = pastDate(entry);
    if (entry.country === home) {
      visited.add(entry.country);
      if (entry.region) addSeal(entry.region, date, false);
      continue;
    }
    visited.add(entry.country);
    stamps.push({ id: `past:${entry.id}`, country: entry.country, date, place: entry.place, tripId: null, pastId: entry.id, viaApp: false, pending: false });
  }

  stamps.sort((a, b) => Number(a.pending) - Number(b.pending) || a.date.localeCompare(b.date));
  const done = stamps.filter((stamp) => !stamp.pending);
  const continents = new Set([...visited].map(continentOf).filter((continent): continent is string => Boolean(continent)));

  return {
    home,
    stamps,
    seals: [...seals.values()].sort((a, b) => b.visits - a.visits || a.first.localeCompare(b.first)),
    countries: visited.size,
    continents: continents.size,
    daysAbroad,
    latest: done.reduce<Stamp | null>((latest, stamp) => (!latest || stamp.date >= latest.date ? stamp : latest), null),
  };
}

/** Deterministic 0..n-1 from a string, so a country always gets the same stamp shape and ink. */
export function pick(value: string, n: number, salt = 0): number {
  let hash = 2166136261 ^ salt;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % n;
}

/** "2026-10-18" → "18 Oct 2026", "2019-05" → "May 2019", "2018" → "2018". */
export function stampDate(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!m) return String(y);
  const value = new Date(y, m - 1, d || 1);
  return dateTimeFormat(locale, d ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "numeric" }).format(value);
}
