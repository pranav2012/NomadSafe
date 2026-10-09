/** In the trip currency, for every traveller together. */
export interface TripBudgetTotals {
  total: number;
  daily: number;
}

/** Rounds to about two significant figures (13,240 → 13,000; 1,234 → 1,250; 87 stays 87) so an estimate doesn't look precise. */
export function roundEstimate(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const step = Math.max(1, 10 ** (Math.floor(Math.log10(value)) - 1) / 2);
  return Math.round(value / step) * step;
}

/**
 * Trip totals from a per-person daily cost in USD and the USD → trip currency rate. Null when any
 * input is unusable, so the card hides the estimate rather than showing a wrong currency.
 */
export function tripBudgetTotals(dailyUsdPerPerson: number, days: number, travelers: number, usdRate: number | null): TripBudgetTotals | null {
  if (usdRate === null || !Number.isFinite(usdRate) || usdRate <= 0) return null;
  if (!Number.isFinite(dailyUsdPerPerson) || dailyUsdPerPerson <= 0) return null;
  if (!Number.isInteger(days) || days < 1 || !Number.isInteger(travelers) || travelers < 1) return null;
  const daily = dailyUsdPerPerson * travelers * usdRate;
  return { total: roundEstimate(daily * days), daily: roundEstimate(daily) };
}
