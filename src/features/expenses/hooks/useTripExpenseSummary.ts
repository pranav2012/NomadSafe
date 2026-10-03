import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import {
  fetchExchangeRate,
  getCachedExchangeRate,
} from "@/features/expenses/services/currencyConversion";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import type { Trip } from "@/features/trips/store/tripsStore";

export interface ConvertibleAmount {
  amount: number;
  currency: string;
  date: string;
}

export interface ConvertedExpense<T extends ConvertibleAmount = Expense> {
  expense: T;
  amount: number;
}

export interface UnconvertedTotal {
  currency: string;
  amount: number;
  count: number;
}

function rateKey(expense: ConvertibleAmount, targetCurrency: string): string {
  return `${expense.currency}|${targetCurrency}|${toLocalDayKey(expense.date)}`;
}

/**
 * Converts expenses into `targetCurrency`. Expenses without a rate are left out
 * of totals and reported in `unconvertedTotals`; failed fetches retry on focus
 * and app foreground.
 */
export function useConvertedExpenses<T extends ConvertibleAmount = Expense>(expenses: T[], targetCurrency: string) {
  const [failedRates, setFailedRates] = useState<Set<string>>(new Set());
  // Rates live in state (not just the module cache) so memoized renders — the
  // React Compiler is on — recompute when a rate arrives.
  const [rates, setRates] = useState<Record<string, number>>({});
  const [retryToken, setRetryToken] = useState(0);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);
  useFocusEffect(retry);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") retry();
    });
    return () => subscription.remove();
  }, [retry]);

  useEffect(() => {
    const needed = expenses.filter((expense) => expense.currency !== targetCurrency);
    if (needed.length === 0) return;

    let mounted = true;
    const unique = [...new Map(needed.map((expense) => [rateKey(expense, targetCurrency), expense])).values()];
    void Promise.all(
      unique.map(async (expense) => {
        const key = rateKey(expense, targetCurrency);
        try {
          const rate =
            getCachedExchangeRate(expense.currency, targetCurrency, expense.date) ??
            (await fetchExchangeRate(expense.currency, targetCurrency, expense.date));
          if (!mounted) return;
          setRates((current) => (current[key] === rate.rate ? current : { ...current, [key]: rate.rate }));
          setFailedRates((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        } catch {
          if (mounted) setFailedRates((current) => (current.has(key) ? current : new Set([...current, key])));
        }
      }),
    );

    return () => {
      mounted = false;
    };
  }, [expenses, targetCurrency, retryToken]);

  const convertedExpenses: ConvertedExpense<T>[] = [];
  const unavailableExpenses: T[] = [];
  for (const expense of expenses) {
    const rate = expense.currency === targetCurrency ? 1 : rates[rateKey(expense, targetCurrency)];
    if (rate === undefined) {
      unavailableExpenses.push(expense);
      continue;
    }
    convertedExpenses.push({ expense, amount: expense.amount * rate });
  }

  const unconverted = new Map<string, UnconvertedTotal>();
  for (const expense of unavailableExpenses) {
    const entry = unconverted.get(expense.currency) ?? { currency: expense.currency, amount: 0, count: 0 };
    entry.amount += expense.amount;
    entry.count += 1;
    unconverted.set(expense.currency, entry);
  }

  return {
    convertedExpenses,
    unavailableExpenses,
    unconvertedTotals: [...unconverted.values()],
    isConverting: unavailableExpenses.some((expense) => !failedRates.has(rateKey(expense, targetCurrency))),
    hasConversionFailures: unavailableExpenses.some((expense) => failedRates.has(rateKey(expense, targetCurrency))),
  };
}

export function useTripExpenseSummary(trip: Trip | null) {
  const expenses = useExpensesStore((state) => state.expenses);
  const scopedExpenses = useMemo(
    () => (trip ? expenses.filter((expense) => expense.tripId === trip.id) : []),
    [expenses, trip],
  );
  const conversion = useConvertedExpenses(scopedExpenses, trip?.currency ?? "");

  const categoryTotals = new Map<ExpenseCategory, number>();
  const dailyTotals = new Map<string, number>();
  for (const { expense, amount } of conversion.convertedExpenses) {
    categoryTotals.set(expense.category, (categoryTotals.get(expense.category) ?? 0) + amount);
    const day = toLocalDayKey(expense.date);
    dailyTotals.set(day, (dailyTotals.get(day) ?? 0) + amount);
  }

  return {
    ...conversion,
    total: conversion.convertedExpenses.reduce((sum, entry) => sum + entry.amount, 0),
    categoryTotals: [...categoryTotals.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount),
    dailyTotals: [...dailyTotals.entries()]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
