import { useEffect, useMemo } from "react";
import { useFocusEffect } from "expo-router";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { requestRates, retryRates, useRatesStore, type RateRequest } from "@/features/expenses/store/ratesStore";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { rateKey, type ConvertibleAmount } from "@/features/expenses/utils/rates";
import type { Trip } from "@/features/trips/store/tripsStore";

export type { ConvertibleAmount };

export interface ConvertedExpense<T extends ConvertibleAmount = Expense> {
  expense: T;
  amount: number;
}

export interface UnconvertedTotal {
  currency: string;
  amount: number;
  count: number;
}

/**
 * Loads the exchange rates `requests` need into the shared rates store and returns its rates and
 * failures (kept in a store, not the module cache, so compiled renders update when a rate arrives).
 * Failed and offline rates are asked for again on focus and app foreground.
 */
export function useRateRequests(requests: RateRequest[]) {
  const rates = useRatesStore((state) => state.rates);
  const failed = useRatesStore((state) => state.failed);
  const generation = useRatesStore((state) => state.generation);
  useFocusEffect(retryRates);
  useEffect(() => {
    requestRates(requests);
  }, [requests, generation]);
  return { rates, failed };
}

/**
 * Converts expenses into `targetCurrency`. Expenses without a rate are left out
 * of totals and reported in `unconvertedTotals`.
 */
export function useConvertedExpenses<T extends ConvertibleAmount = Expense>(expenses: T[], targetCurrency: string) {
  const requests = useMemo(
    () => expenses.map((expense) => ({ currency: expense.currency, target: targetCurrency, date: expense.date })),
    [expenses, targetCurrency],
  );
  const { rates, failed } = useRateRequests(requests);

  const convertedExpenses: ConvertedExpense<T>[] = [];
  const unavailableExpenses: T[] = [];
  for (const expense of expenses) {
    const rate = expense.currency === targetCurrency ? 1 : rates[rateKey(expense.currency, targetCurrency, expense.date)];
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

  const isFailed = (expense: T) => Boolean(failed[rateKey(expense.currency, targetCurrency, expense.date)]);
  return {
    convertedExpenses,
    unavailableExpenses,
    unconvertedTotals: [...unconverted.values()],
    isConverting: unavailableExpenses.some((expense) => !isFailed(expense)),
    hasConversionFailures: unavailableExpenses.some(isFailed),
  };
}

export function useTripExpenseSummary(trip: Trip | null) {
  const expenses = useExpensesStore((state) => state.expenses);
  const scopedExpenses = useMemo(
    () => (trip ? expenses.filter((expense) => expense.groupId === trip.id) : []),
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
