import { addDays, fromDateKey, startOfLocalDay } from "@/features/trips/utils/dates";
import { inRange, periodRange, type SpendPeriod } from "./myMoney";

export interface InsightItem {
  id?: string;
  amount: number;
  date: string;
  category: string;
  merchant?: string;
  group?: string;
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

/** Totals for `count` weeks or months ending `endOffset` periods back (oldest first). */
export function periodTotals(items: { amount: number; date: string }[], period: SpendPeriod, count: number, endOffset = 0, now: Date = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const offset = endOffset + count - 1 - index;
    const range = periodRange(period, offset, now);
    return { start: range.start, offset, total: sum(items.filter((item) => inRange(item.date, range))) };
  });
}

/**
 * Totals for this month and each of `months` months back, and this year and `years` years back, in
 * one pass (`months[n]` matches `periodTotals(items, "month", 1, n)`).
 */
export function totalsByOffset(items: { amount: number; date: string }[], months: number, years: number, now: Date = new Date()) {
  const monthTotals = new Array<number>(months + 1).fill(0);
  const yearTotals = new Array<number>(years + 1).fill(0);
  for (const item of items) {
    const date = new Date(item.date);
    const time = date.getTime();
    if (Number.isNaN(time)) continue;
    const yearBack = now.getFullYear() - date.getFullYear();
    const monthBack = yearBack * 12 + now.getMonth() - date.getMonth();
    if (monthBack >= 0 && monthBack <= months) monthTotals[monthBack] += item.amount;
    if (yearBack >= 0 && yearBack <= years) yearTotals[yearBack] += item.amount;
  }
  return { months: monthTotals, years: yearTotals };
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

export interface CategoryVsUsual {
  category: string;
  amount: number;
  usual: number | null;
}

function firstTime(items: { date: string }[]): number | null {
  return items.reduce<number | null>((min, item) => {
    const time = new Date(item.date).getTime();
    return min === null || time < min ? time : min;
  }, null);
}

/**
 * A month or year by category against your usual: for a month, the average of up to 3 months before it; for a year,
 * the year before. Only periods since your first spend count, so a new user isn't compared with empty ones.
 */
export function periodVsUsual(items: InsightItem[], period: "month" | "year", offset: number, now: Date = new Date()) {
  const current = items.filter((item) => inRange(item.date, periodRange(period, offset, now)));
  const first = firstTime(items);
  const base = (period === "month" ? [1, 2, 3] : [1])
    .map((back) => periodRange(period, offset + back, now))
    .filter((range) => first !== null && range.end.getTime() > first);
  const baseItems = items.filter((item) => base.some((range) => inRange(item.date, range)));
  const usualOf = (category: string | null) =>
    base.length === 0 ? null : sum(baseItems.filter((item) => category === null || item.category === category)) / base.length;
  const categories: CategoryVsUsual[] = byCategory(current).map((entry) => ({ ...entry, usual: usualOf(entry.category) }));
  return { total: sum(current), usualTotal: usualOf(null), categories };
}

/** A year's months up to this month (oldest first), and its monthly average over the months since your first spend. */
export function yearByMonth(items: { amount: number; date: string }[], offset: number, now: Date = new Date()) {
  const year = now.getFullYear() - offset;
  const lastMonth = offset === 0 ? now.getMonth() : 11;
  const months = Array.from({ length: lastMonth + 1 }, (_, month) => {
    const start = new Date(year, month, 1);
    const range = { start, end: new Date(year, month + 1, 1) };
    return { start, total: sum(items.filter((item) => inRange(item.date, range))) };
  });
  const first = firstTime(items);
  const counted = months.filter((month) => first !== null && new Date(month.start.getFullYear(), month.start.getMonth() + 1, 1).getTime() > first).length;
  const total = sum(months.map((month) => ({ amount: month.total })));
  return { months, average: counted > 0 ? total / counted : 0 };
}

/** How much more per day you spend on weekends than weekdays (or the reverse, below 1) over the last 90 days; null when there's too little data or no real difference. */
export function weekendRatio(items: { amount: number; date: string }[], now: Date = new Date()): number | null {
  const today = startOfLocalDay(now);
  const from = addDays(today, -89);
  const recent = items.filter((item) => {
    const day = startOfLocalDay(new Date(item.date));
    return day >= from && day <= today;
  });
  if (recent.length < 8) return null;
  const firstDay = startOfLocalDay(new Date(Math.min(...recent.map((item) => new Date(item.date).getTime()))));
  const totals = { weekend: 0, weekday: 0 };
  const days = { weekend: 0, weekday: 0 };
  for (let day = firstDay; day <= today; day = addDays(day, 1)) days[day.getDay() % 6 === 0 ? "weekend" : "weekday"] += 1;
  if (days.weekend + days.weekday < 28) return null;
  for (const item of recent) totals[new Date(item.date).getDay() % 6 === 0 ? "weekend" : "weekday"] += item.amount;
  const weekendPerDay = totals.weekend / days.weekend;
  const weekdayPerDay = totals.weekday / days.weekday;
  if (weekendPerDay <= 0 || weekdayPerDay <= 0) return null;
  const ratio = weekendPerDay / weekdayPerDay;
  return ratio >= 1.3 || ratio <= 1 / 1.3 ? ratio : null;
}

export interface TripPace {
  perDay: number;
  spent: number;
  daysLeft: number;
  projected: number;
  plannedPerDay: number | null;
  leftPerDay: number | null;
}

/** Your daily pace on a started trip against its budget (0 = none); spends before the start count toward the total, not the pace. */
export function tripPace(items: InsightItem[], trip: { startDate: string; endDate: string; budget: number }, now: Date = new Date()): TripPace {
  const { buckets, before } = tripDailyTotals(items, trip, now);
  const elapsed = buckets.reduce((total, bucket) => total + bucket.days, 0);
  const onTrip = sum(buckets.map((bucket) => ({ amount: bucket.total })));
  const totalDays = Math.max(1, Math.round((fromDateKey(trip.endDate).getTime() - fromDateKey(trip.startDate).getTime()) / DAY_MS) + 1);
  const daysLeft = Math.max(0, totalDays - elapsed);
  const perDay = onTrip / elapsed;
  const spent = onTrip + before;
  const budget = Number.isFinite(trip.budget) && trip.budget > 0 ? trip.budget : null;
  return {
    perDay,
    spent,
    daysLeft,
    projected: spent + perDay * daysLeft,
    plannedPerDay: budget ? budget / totalDays : null,
    leftPerDay: budget && daysLeft > 0 ? Math.max(0, budget - spent) / daysLeft : null,
  };
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
