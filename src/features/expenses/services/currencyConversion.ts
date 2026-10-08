import { translate } from "@/localization/translate";
import { withAppCheck } from "@/modules/appCheck";
import { api, convex } from "@/modules/backend";
import { storage } from "@/modules/storage";
import { useAuthStore } from "@/features/auth/store/authStore";
import { fromLocalDayKey, toLocalDayKey } from "@/features/expenses/utils/dateKey";

export interface ExchangeRate {
  base: string;
  quote: string;
  date: string;
  rate: number;
}

interface DayRate {
  date: string;
  rate: number;
}

const FETCH_TIMEOUT_MS = 8_000;
const STORED_PREFIX = "fx-rates:";
const STORED_DAYS_PER_PAIR = 30;

const rateCache = new Map<string, ExchangeRate>();

// Some builds stored every target's rates under one key per base currency ("fx-rates:JPY|"), mixing them up.
for (const key of storage.getAllKeys()) {
  if (/^fx-rates:[A-Z]{3}\|$/.test(key)) storage.remove(key);
}
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

function validRate(value: { date?: unknown; rate?: unknown } | null | undefined): DayRate | null {
  if (!value || typeof value.date !== "string" || !value.date) return null;
  const { rate } = value;
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? { date: value.date, rate } : null;
}

/** Resolves to null after `ms`, so a request that never settles (e.g. queued while offline) can't hang a caller. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The shared server copy (a cached Convex query) if current, else a refresh when signed in; a stale copy if that fails. */
async function fromServer(base: string, quote: string, day: string): Promise<DayRate | null> {
  // Calls queue while disconnected; skip straight to the fallbacks instead of waiting out the timeout.
  if (!convex.connectionState().isWebSocketConnected) return null;
  const lookup = async () => {
    const cached = await convex.query(api.rates.rate, { base, quote, day });
    if (cached && (cached.expiresAt === null || cached.expiresAt > Date.now())) return validRate(cached);
    // Refresh is signed-in only; signed out, a miss goes straight to Frankfurter.
    if (!useAuthStore.getState().isSignedIn) return validRate(cached);
    const refreshed = await convex.action(api.rates.refresh, await withAppCheck({ base, quote, day }));
    return validRate(refreshed) ?? validRate(cached);
  };
  try {
    return await within(lookup(), FETCH_TIMEOUT_MS);
  } catch {
    return null;
  }
}

/** Frankfurter directly from the phone: used when signed out or when our server can't answer. */
async function fromFrankfurter(base: string, quote: string, day: string): Promise<DayRate | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v2/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}?date=${encodeURIComponent(day)}`,
      { signal: controller.signal },
    );
    return response.ok ? validRate((await response.json()) as { date?: unknown; rate?: unknown }) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    const day = dateKey(date);
    const found = (await fromServer(base.toUpperCase(), quote.toUpperCase(), day)) ?? (await fromFrankfurter(base, quote, day));
    if (!found) {
      // Offline or failed: use the closest stored rate (not cached, so the next try refetches).
      const fallback = nearestStoredRate(base, quote, day);
      if (fallback) return fallback;
      throw new Error("Exchange-rate request failed.");
    }
    const rate = { base, quote, date: found.date, rate: found.rate };
    rateCache.set(key, rate);
    storeRate(base, quote, day, rate);
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
