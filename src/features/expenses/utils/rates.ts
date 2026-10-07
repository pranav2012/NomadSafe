import { toLocalDayKey } from "./dateKey";

export interface ConvertibleAmount {
  amount: number;
  currency: string;
  date: string;
}

/** Key of the rate that converts `currency` into `target` on the local day of `date`. */
export function rateKey(currency: string, target: string, date: string): string {
  return `${currency}|${target}|${toLocalDayKey(date)}`;
}

/** Converter for split math: the multiplier into `target`, or null while a rate is missing. */
export function converterFrom(rates: Record<string, number>, target: string) {
  return (_amount: number, currency: string, date: string): number | null =>
    currency === target ? 1 : rates[rateKey(currency, target, date)] ?? null;
}
