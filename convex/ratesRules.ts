// No Convex imports, so tests can load this file directly.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const RECENT_RATE_TTL_MS = 6 * HOUR_MS;
export const PRUNE_RATES_AFTER_MS = 90 * DAY_MS;

const CURRENCY_RE = /^[A-Z]{3}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCurrencyCode(code: string) {
  return CURRENCY_RE.test(code);
}

export function isDayKey(day: string) {
  return DAY_RE.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
}

export function rateKey(base: string, quote: string, day: string) {
  return `${base}|${quote}|${day}`;
}

/** Never expires once the day is over everywhere; phones ask by local day, so "recent" starts a day before UTC today. */
export function rateExpiry(day: string, now: number): number | undefined {
  const recentFrom = new Date(now - DAY_MS).toISOString().slice(0, 10);
  return day >= recentFrom ? now + RECENT_RATE_TTL_MS : undefined;
}

export interface ParsedRate {
  date: string;
  rate: number;
}

export function parseFrankfurterRate(payload: unknown): ParsedRate | null {
  if (!payload || typeof payload !== "object") return null;
  const { rate, date } = payload as { rate?: unknown; date?: unknown };
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  if (typeof date !== "string" || !isDayKey(date)) return null;
  return { date, rate };
}
