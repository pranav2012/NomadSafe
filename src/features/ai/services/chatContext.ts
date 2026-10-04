import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  fetchExchangeRate,
  getCachedExchangeRate,
} from "@/features/expenses/services/currencyConversion";
import { getCurrentLocale } from "@/localization/translate";
import {
  computeMoneyFacts,
  formatFactsBlock,
  tripDayProgress,
  type MoneyExpenseInput,
  type MoneyFacts,
} from "./moneyFacts";

const RATE_WAIT_MS = 2500;

export interface TripMoneySnapshot {
  facts: MoneyFacts;
  context: string;
  locale: string;
}

/**
 * Trip the AI features talk about: the explicitly active trip, else the trip
 * whose dates include today, else none. Shared by chat and the dashboard.
 */
export function resolveContextTrip(trips: Trip[], activeTripId: string | null): Trip | null {
  const active = trips.find((t) => t.id === activeTripId);
  if (active) return active;
  const now = new Date();
  return trips.find((t) => tripDayProgress(t, now).status === "active") ?? null;
}

async function rateWithin(base: string, quote: string, date: string): Promise<number | null> {
  const cached = getCachedExchangeRate(base, quote, date);
  if (cached) return cached.rate;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rate = await Promise.race([
      fetchExchangeRate(base, quote, date),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RATE_WAIT_MS);
      }),
    ]);
    return rate?.rate ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Computes the money facts for the chat's trip, converting expenses to the trip
 * currency (fetching missing rates briefly). Returns null when there is no trip.
 * With `hideEmailMerchants`, merchants read from Gmail are left out (the facts fall back to the
 * category), so Google user data never goes to an online AI provider.
 */
export async function loadTripMoneySnapshot(
  now: Date = new Date(),
  { hideEmailMerchants = false }: { hideEmailMerchants?: boolean } = {},
): Promise<TripMoneySnapshot | null> {
  const { trips, activeTripId } = useTripsStore.getState();
  const trip = resolveContextTrip(trips, activeTripId);
  if (!trip) return null;

  const tripExpenses = useExpensesStore
    .getState()
    .expenses.filter((expense) => expense.tripId === trip.id);
  const converted = await Promise.all(
    tripExpenses.map(async (expense): Promise<MoneyExpenseInput | null> => {
      const rate = await rateWithin(expense.currency, trip.currency, expense.date);
      if (rate === null) return null;
      return {
        amount: expense.amount * rate,
        category: expense.category,
        merchant: hideEmailMerchants && expense.source === "email" ? "" : expense.merchant,
        date: expense.date,
      };
    }),
  );
  const expenses = converted.filter((entry): entry is MoneyExpenseInput => entry !== null);
  const facts = computeMoneyFacts({
    trip,
    expenses,
    unconvertedCount: tripExpenses.length - expenses.length,
    now,
  });
  const locale = getCurrentLocale();
  return { facts, context: formatFactsBlock(facts, locale, now), locale };
}
