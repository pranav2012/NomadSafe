import { translate } from "@/localization/translate";
import { storage } from "@/stores/storage";
import { fromLocalDayKey, toLocalDayKey } from "@/features/expenses/utils/dateKey";

export interface ExchangeRate {
  base: string;
  quote: string;
  date: string;
  rate: number;
}

interface FrankfurterRateResponse {
  base?: string;
  quote?: string;
  date?: string;
  rate?: number;
}

const FETCH_TIMEOUT_MS = 8_000;
const STORED_PREFIX = "fx-rates:";
const STORED_DAYS_PER_PAIR = 30;

const rateCache = new Map<string, ExchangeRate>();
const inFlightRates = new Map<string, Promise<ExchangeRate>>();

function dateKey(value: string): string {
  return toLocalDayKey(value);
}

function cacheKey(base: string, quote: string, date: string): string {
  return `${base.toUpperCase()}|${quote.toUpperCase()}|${dateKey(date)}`;
}

function pairKey(base: string, quote: string): string {
  return `${STORED_PREFIX}${base.toUpperCase()}|${quote.toUpperCase()}`;
}

/** Stored rates for one pair, keyed by the requested local day. */
function readStoredRates(base: string, quote: string): Record<string, ExchangeRate> {
  const raw = storage.getString(pairKey(base, quote));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ExchangeRate>;
  } catch {
    storage.remove(pairKey(base, quote));
    return {};
  }
}

/** Persists a fetched rate, keeping only the latest days for the pair. */
function storeRate(base: string, quote: string, day: string, rate: ExchangeRate) {
  const entries = Object.entries({ ...readStoredRates(base, quote), [day]: rate })
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, STORED_DAYS_PER_PAIR);
  storage.set(pairKey(base, quote), JSON.stringify(Object.fromEntries(entries)));
}

/** Offline fallback: the stored rate whose day is closest to `day`. */
function nearestStoredRate(base: string, quote: string, day: string): ExchangeRate | undefined {
  const target = fromLocalDayKey(day).getTime();
  let best: { rate: ExchangeRate; distance: number } | undefined;
  for (const [storedDay, rate] of Object.entries(readStoredRates(base, quote))) {
    const distance = Math.abs(fromLocalDayKey(storedDay).getTime() - target);
    if (!best || distance < best.distance) best = { rate, distance };
  }
  return best?.rate;
}

export function getCachedExchangeRate(base: string, quote: string, date: string): ExchangeRate | undefined {
  if (base === quote) return { base, quote, date: dateKey(date), rate: 1 };
  const key = cacheKey(base, quote, date);
  const cached = rateCache.get(key);
  if (cached) return cached;
  const stored = readStoredRates(base, quote)[dateKey(date)];
  if (stored) rateCache.set(key, stored);
  return stored;
}

export async function fetchExchangeRate(base: string, quote: string, date: string): Promise<ExchangeRate> {
  if (base === quote) return { base, quote, date: dateKey(date), rate: 1 };

  const key = cacheKey(base, quote, date);
  const cached = getCachedExchangeRate(base, quote, date);
  if (cached) return cached;

  const current = inFlightRates.get(key);
  if (current) return current;

  const request = (async () => {
    // Abort slow requests so imports and totals fall back instead of hanging.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let payload: FrankfurterRateResponse;
    try {
      const response = await fetch(
        `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}?date=${encodeURIComponent(dateKey(date))}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Exchange-rate request failed (${response.status}).`);
      payload = (await response.json()) as FrankfurterRateResponse;
    } catch (error) {
      // Offline or failed: use the closest stored rate (not cached, so the next try refetches).
      const fallback = nearestStoredRate(base, quote, dateKey(date));
      if (fallback) return fallback;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const numericRate = payload.rate;
    if (numericRate === undefined || !payload.date || !Number.isFinite(numericRate) || numericRate <= 0) {
      throw new Error("Exchange-rate response was invalid.");
    }

    const rate = {
      base: payload.base ?? base,
      quote: payload.quote ?? quote,
      date: payload.date,
      rate: numericRate,
    };
    rateCache.set(key, rate);
    storeRate(base, quote, dateKey(date), rate);
    return rate;
  })();

  inFlightRates.set(key, request);
  try {
    return await request;
  } finally {
    inFlightRates.delete(key);
  }
}

export function conversionNote(amount: number, from: string, to: string, rate: ExchangeRate): string {
  return translate("expenses.conversionNote", {
    from,
    to,
    amount: amount.toFixed(2),
    converted: (amount * rate.rate).toFixed(2),
    rate: rate.rate.toFixed(6),
    date: rate.date,
  });
}
