import { fetchExchangeRate } from "@/features/expenses/services/currencyConversion";
import { aiService, type AiProvider } from "@/modules/ai";
import { logger } from "@/modules/logger";
import { tripBudgetTotals, type TripBudgetTotals } from "@/features/trips/utils/budgetEstimate";

export interface TripBudgetResult extends TripBudgetTotals {
  rationale: string;
  provider: AiProvider;
}

export type TripBudgetFailure = "ai" | "rate";

export class TripBudgetError extends Error {
  constructor(readonly reason: TripBudgetFailure) {
    super(`Trip budget estimate failed (${reason}).`);
  }
}

const AI_ATTEMPTS = 2;

/** USD → `currency` for today; null when there's no rate (offline with nothing stored). */
async function usdRateTo(currency: string): Promise<number | null> {
  if (currency.toUpperCase() === "USD") return 1;
  try {
    return (await fetchExchangeRate("USD", currency.toUpperCase(), new Date().toISOString())).rate;
  } catch (error) {
    logger.warn("trip-budget", "no USD rate for the estimate", error);
    return null;
  }
}

/**
 * Mid-range trip budget in the trip currency. The model only gives per-person daily costs in USD (its
 * answer is range-checked); the totals and conversion are done here. Throws `TripBudgetError`.
 */
export async function estimateTripBudget(input: { destinations: string[]; days: number; travelers: number; currency: string }): Promise<TripBudgetResult> {
  const rate = usdRateTo(input.currency);
  let lastError: unknown;
  for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt += 1) {
    try {
      const estimate = await aiService.estimateTripBudget({ destinations: input.destinations, days: input.days, travelerCount: input.travelers });
      const totals = tripBudgetTotals(estimate.dailyUsd, input.days, input.travelers, await rate);
      if (!totals) throw new TripBudgetError("rate");
      return { ...totals, rationale: estimate.rationale, provider: estimate.provider };
    } catch (error) {
      if (error instanceof TripBudgetError) throw error;
      lastError = error;
    }
  }
  logger.warn("trip-budget", "budget estimate failed", lastError);
  throw new TripBudgetError("ai");
}
