import { toLocalDayKey } from "./dateKey";

export type RepeatFrequency = "weekly" | "monthly" | "yearly";

const MAX_CATCH_UP = 24;

function parseDay(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

/** The `index`-th date after `start`; monthly and yearly dates stay on the start day, or the month's last day. */
export function nthOccurrence(startKey: string, frequency: RepeatFrequency, index: number): string {
  const start = parseDay(startKey);
  if (frequency === "weekly") {
    return toLocalDayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 7, 12).toISOString());
  }
  const months = frequency === "monthly" ? index : index * 12;
  const firstOfMonth = new Date(start.getFullYear(), start.getMonth() + months, 1, 12);
  const lastDay = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();
  return toLocalDayKey(new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), Math.min(start.getDate(), lastDay), 12).toISOString());
}

/**
 * Days a recurring spend is due on but hasn't been added for: after `lastAddedKey` up to and
 * including today. Capped so a long-forgotten rule doesn't flood the ledger.
 */
export function dueDays(startKey: string, frequency: RepeatFrequency, lastAddedKey: string | null, todayKey: string): string[] {
  const due: string[] = [];
  for (let index = 0; index < 10_000; index += 1) {
    const day = nthOccurrence(startKey, frequency, index);
    if (day > todayKey) break;
    if (lastAddedKey === null || day > lastAddedKey) due.push(day);
  }
  return due.slice(-MAX_CATCH_UP);
}

/** The next day it will be added on, after today. */
export function nextDueDay(startKey: string, frequency: RepeatFrequency, todayKey: string): string {
  for (let index = 0; index < 10_000; index += 1) {
    const day = nthOccurrence(startKey, frequency, index);
    if (day > todayKey) return day;
  }
  return startKey;
}
