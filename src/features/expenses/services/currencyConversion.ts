import { translate } from "@/localization/translate";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";

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

const rateCache = new Map<string, ExchangeRate>();
const inFlightRates = new Map<string, Promise<ExchangeRate>>();

function dateKey(value: string): string {
  return toLocalDayKey(value);
}

function cacheKey(base: string, quote: string, date: string): string {
  return `${base.toUpperCase()}|${quote.toUpperCase()}|${dateKey(date)}`;
}

export function getCachedExchangeRate(base: string, quote: string, date: string): ExchangeRate | undefined {
  if (base === quote) return { base, quote, date: dateKey(date), rate: 1 };
  return rateCache.get(cacheKey(base, quote, date));
}

export async function fetchExchangeRate(base: string, quote: string, date: string): Promise<ExchangeRate> {
  if (base === quote) return { base, quote, date: dateKey(date), rate: 1 };

  const key = cacheKey(base, quote, date);
  const cached = rateCache.get(key);
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
