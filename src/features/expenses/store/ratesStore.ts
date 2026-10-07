import { AppState } from "react-native";
import { create } from "zustand";
import { fetchExchangeRate, getCachedExchangeRate } from "@/features/expenses/services/currencyConversion";
import { rateKey } from "@/features/expenses/utils/rates";

interface RatesState {
  /** Multiplier per `rateKey`, shared by every conversion on screen. */
  rates: Record<string, number>;
  failed: Record<string, true>;
  /** Bumped when failed or offline-fallback rates should be asked for again. */
  generation: number;
}

export interface RateRequest {
  currency: string;
  target: string;
  date: string;
}

export const useRatesStore = create<RatesState>(() => ({ rates: {}, failed: {}, generation: 0 }));

const inFlight = new Set<string>();
// Offline fallbacks (the nearest stored day), fetched again on the next retry.
const approximate = new Set<string>();

/**
 * Loads the rates `requests` need into the store, once per key: from the cache at once, else the
 * network. Keys that failed wait for `retryRates`.
 */
export function requestRates(requests: RateRequest[]) {
  const { rates, failed } = useRatesStore.getState();
  const found: Record<string, number> = {};
  for (const { currency, target, date } of requests) {
    if (currency === target) continue;
    const key = rateKey(currency, target, date);
    if (inFlight.has(key) || failed[key] || (key in rates && !approximate.has(key)) || key in found) continue;
    const cached = getCachedExchangeRate(currency, target, date);
    if (cached) {
      approximate.delete(key);
      found[key] = cached.rate;
      continue;
    }
    inFlight.add(key);
    fetchExchangeRate(currency, target, date)
      .then((rate) => {
        if (getCachedExchangeRate(currency, target, date)) approximate.delete(key);
        else approximate.add(key);
        useRatesStore.setState((state) => ({
          rates: state.rates[key] === rate.rate ? state.rates : { ...state.rates, [key]: rate.rate },
          failed: key in state.failed ? withoutKey(state.failed, key) : state.failed,
        }));
      })
      .catch(() => useRatesStore.setState((state) => (state.failed[key] ? state : { failed: { ...state.failed, [key]: true } })))
      .finally(() => inFlight.delete(key));
  }
  if (Object.keys(found).length > 0) useRatesStore.setState((state) => ({ rates: { ...state.rates, ...found } }));
}

/** Asks again for rates that failed or came from the offline fallback (on focus and app foreground). */
export function retryRates() {
  const { failed } = useRatesStore.getState();
  if (Object.keys(failed).length === 0 && approximate.size === 0) return;
  useRatesStore.setState((state) => ({ failed: {}, generation: state.generation + 1 }));
}

function withoutKey(record: Record<string, true>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

AppState.addEventListener("change", (state) => {
  if (state === "active") retryRates();
});
