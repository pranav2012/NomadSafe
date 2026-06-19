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

const rateCache = new Map<string, ExchangeRate>();
const inFlightRates = new Map<string, Promise<ExchangeRate>>();

function dateKey(value: string): string {
  return value.slice(0, 10);
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
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}?date=${encodeURIComponent(dateKey(date))}`,
    );
    if (!response.ok) throw new Error(`Exchange-rate request failed (${response.status}).`);

    const payload = (await response.json()) as FrankfurterRateResponse;
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
  const converted = amount * rate.rate;
  return `Trip total conversion: ${from} ${amount.toFixed(2)} → ${to} ${converted.toFixed(2)} at 1 ${from} = ${rate.rate.toFixed(6)} ${to} (${rate.date} reference rate).`;
}
