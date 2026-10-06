import { addDays, fromDateKey, startOfLocalDay } from "@/features/trips/utils/dates";
import { inRange, periodRange, type SpendPeriod } from "./myMoney";

export interface InsightItem {
  amount: number;
  date: string;
  category: string;
  merchant?: string;
}

export interface CategoryAmount {
  category: string;
  amount: number;
}

const DAY_MS = 86_400_000;
const MAX_DAY_BARS = 31;

function byCategory(items: InsightItem[]): CategoryAmount[] {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.category, (totals.get(item.category) ?? 0) + item.amount);
  return [...totals.entries()].map(([category, amount]) => ({ category, amount })).filter((entry) => entry.amount > 0).sort((a, b) => b.amount - a.amount);
}

const sum = (items: { amount: number }[]) => items.reduce((total, item) => total + item.amount, 0);

/** Your spend per calendar month for the last `months` months (oldest first), split by category. */
export function monthlyByCategory(items: InsightItem[], months: number, now: Date = new Date()) {
  return Array.from({ length: months }, (_, index) => {
    const offset = months - 1 - index;
    const range = periodRange("month", offset, now);
    const inMonth = items.filter((item) => inRange(item.date, range));
    return { start: range.start, offset, total: sum(inMonth), categories: byCategory(inMonth) };
  });
}

/** Spend per trip day up to today (weeks for trips over a month); spends before the start are returned apart. */
export function tripDailyTotals(items: InsightItem[], trip: { startDate: string; endDate: string }, now: Date = new Date()) {
  const start = fromDateKey(trip.startDate);
  const end = fromDateKey(trip.endDate);
  const today = startOfLocalDay(now);
  const last = today < end ? today : end;
  const days = Math.max(1, Math.round((last.getTime() - start.getTime()) / DAY_MS) + 1);
  const step = days > MAX_DAY_BARS ? 7 : 1;
  const buckets = Array.from({ length: Math.ceil(days / step) }, (_, index) => ({
    day: index * step + 1,
    start: addDays(start, index * step),
    days: Math.min(step, days - index * step),
    total: 0,
  }));
  let before = 0;
  for (const item of items) {
    const day = Math.floor((startOfLocalDay(new Date(item.date)).getTime() - start.getTime()) / DAY_MS);
    if (day < 0) before += item.amount;
    else if (day < days) buckets[Math.floor(day / step)].total += item.amount;
  }
  return { buckets, step, before };
}

/** Months between the first item and now (1 for this month); 0 with no items. */
export function monthsOfHistory(items: { date: string }[], now: Date = new Date()): number {
  if (items.length === 0) return 0;
  const first = new Date(Math.min(...items.map((item) => new Date(item.date).getTime())));
  return (now.getFullYear() - first.getFullYear()) * 12 + now.getMonth() - first.getMonth() + 1;
}

export interface PeriodComparison {
  change: number | null;
  mover: { category: string; change: number } | null;
}

/** Total change vs the previous period (null if it had none) and the category that moved most in money. */
export function comparePeriods(current: InsightItem[], previous: InsightItem[]): PeriodComparison {
  const before = sum(previous);
  const change = before > 0 ? sum(current) / before - 1 : null;
  const was = new Map(byCategory(previous).map((entry) => [entry.category, entry.amount]));
  let mover: PeriodComparison["mover"] = null;
  let biggest = 0;
  for (const entry of byCategory(current)) {
    const old = was.get(entry.category);
    if (!old) continue;
    const diff = Math.abs(entry.amount - old);
    if (diff > biggest) {
      biggest = diff;
      mover = { category: entry.category, change: entry.amount / old - 1 };
    }
  }
  for (const [category, old] of was) {
    if (!current.some((item) => item.category === category) && old > biggest) {
      biggest = old;
      mover = { category, change: -1 };
    }
  }
  return { change, mover };
}

/** Where this period's spend is heading at today's rate; null for past periods or too early to tell. */
export function paceFor(period: SpendPeriod, offset: number, spent: number, now: Date = new Date()): number | null {
  if (offset !== 0 || spent <= 0) return null;
  const range = periodRange(period, 0, now);
  const totalDays = Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS);
  const elapsed = Math.round((startOfLocalDay(now).getTime() - range.start.getTime()) / DAY_MS) + 1;
  if (elapsed < (period === "month" ? 5 : 3) || elapsed >= totalDays) return null;
  return (spent / elapsed) * totalDays;
}

/** The places you spent most at, by merchant name; blank names are left out. */
export function topPlaces(items: InsightItem[], limit: number) {
  const places = new Map<string, { name: string; amount: number; count: number }>();
  for (const item of items) {
    const name = item.merchant?.trim();
    if (!name || item.amount <= 0) continue;
    const key = name.toLowerCase();
    const entry = places.get(key) ?? { name, amount: 0, count: 0 };
    entry.amount += item.amount;
    entry.count += 1;
    places.set(key, entry);
  }
  return [...places.values()].sort((a, b) => b.amount - a.amount).slice(0, limit);
}
