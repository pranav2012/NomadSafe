import { useEffect, useMemo, useState } from "react";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import {
  fetchExchangeRate,
  getCachedExchangeRate,
} from "@/features/expenses/services/currencyConversion";
import type { Trip } from "@/features/trips/store/tripsStore";

export interface ConvertedExpense {
  expense: Expense;
  amount: number;
}

function rateKey(expense: Expense, tripCurrency: string): string {
  return `${expense.currency}|${tripCurrency}|${expense.date.slice(0, 10)}`;
}

export function useTripExpenseSummary(trip: Trip | null) {
  const expenses = useExpensesStore((state) => state.expenses);
  const [failedRates, setFailedRates] = useState<Set<string>>(new Set());
  const [, setRateVersion] = useState(0);
  const scopedExpenses = useMemo(
    () => (trip ? expenses.filter((expense) => expense.tripId === trip.id) : []),
    [expenses, trip],
  );

  useEffect(() => {
    if (!trip) return;
    const pending = scopedExpenses.filter(
      (expense) =>
        expense.currency !== trip.currency &&
        !getCachedExchangeRate(expense.currency, trip.currency, expense.date),
    );
    if (pending.length === 0) return;

    let mounted = true;
    void Promise.all(
      [...new Map(pending.map((expense) => [rateKey(expense, trip.currency), expense])).values()].map(
        async (expense) => {
          try {
            await fetchExchangeRate(expense.currency, trip.currency, expense.date);
          } catch {
            if (mounted) {
              setFailedRates((current) => new Set([...current, rateKey(expense, trip.currency)]));
            }
          }
        },
      ),
    ).then(() => {
      if (mounted) setRateVersion((version) => version + 1);
    });

    return () => {
      mounted = false;
    };
  }, [scopedExpenses, trip]);

  return (() => {
    const convertedExpenses: ConvertedExpense[] = [];
    const unavailableExpenses: Expense[] = [];

    for (const expense of scopedExpenses) {
      const rate = getCachedExchangeRate(expense.currency, trip?.currency ?? expense.currency, expense.date);
      if (!rate) {
        unavailableExpenses.push(expense);
        continue;
      }
      convertedExpenses.push({ expense, amount: expense.amount * rate.rate });
    }

    const categoryTotals = new Map<ExpenseCategory, number>();
    const dailyTotals = new Map<string, number>();
    for (const { expense, amount } of convertedExpenses) {
      categoryTotals.set(expense.category, (categoryTotals.get(expense.category) ?? 0) + amount);
      const day = expense.date.slice(0, 10);
      dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + amount);
    }

    return {
      total: convertedExpenses.reduce((sum, entry) => sum + entry.amount, 0),
      convertedExpenses,
      unavailableExpenses,
      categoryTotals: [...categoryTotals.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount),
      dailyTotals: [...dailyTotals.entries()]
        .map(([date, amount]) => ({ date, amount }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      isConverting:
        scopedExpenses.some(
          (expense) =>
            expense.currency !== trip?.currency &&
            !getCachedExchangeRate(expense.currency, trip?.currency ?? expense.currency, expense.date),
        ) && unavailableExpenses.some((expense) => !failedRates.has(rateKey(expense, trip?.currency ?? expense.currency))),
    };
  })();
}
