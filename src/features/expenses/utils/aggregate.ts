import type { Expense } from "@/features/expenses/store/expensesStore";
import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/features/expenses/constants/categories";

export interface CategoryTotal {
  category: ExpenseCategory;
  amount: number;
  pct: number;
}

export interface DayTotal {
  date: string;
  amount: number;
}

export interface MerchantTotal {
  merchant: string;
  amount: number;
  count: number;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function filterByTrip(expenses: Expense[], tripId: string | null): Expense[] {
  if (!tripId) return expenses;
  return expenses.filter((expense) => expense.tripId === tripId);
}

export function sumAmount(expenses: Expense[]): number {
  return expenses.reduce((total, expense) => total + expense.amount, 0);
}

/** Expenses dated within the calendar month of `reference` (defaults to now). */
export function filterByMonth(expenses: Expense[], reference = new Date()): Expense[] {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  return expenses.filter((expense) => {
    const date = new Date(expense.date);
    return date.getFullYear() === year && date.getMonth() === month;
  });
}

export function categoryBreakdown(expenses: Expense[]): CategoryTotal[] {
  const totals = new Map<ExpenseCategory, number>();
  for (const expense of expenses) {
    totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
  }
  const grand = sumAmount(expenses);

  return EXPENSE_CATEGORIES.map((meta) => {
    const amount = totals.get(meta.id) ?? 0;
    return {
      category: meta.id,
      amount,
      pct: grand > 0 ? (amount / grand) * 100 : 0,
    };
  })
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Daily totals for the last `days` days ending today, oldest first. */
export function dailySeries(expenses: Expense[], days: number): DayTotal[] {
  const today = startOfDay(new Date());
  const byDay = new Map<string, number>();
  for (const expense of expenses) {
    const key = toDayKey(startOfDay(new Date(expense.date)));
    byDay.set(key, (byDay.get(key) ?? 0) + expense.amount);
  }

  const series: DayTotal[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);
    const key = toDayKey(date);
    series.push({ date: key, amount: byDay.get(key) ?? 0 });
  }
  return series;
}

export function topMerchants(expenses: Expense[], limit: number): MerchantTotal[] {
  const byMerchant = new Map<string, MerchantTotal>();
  for (const expense of expenses) {
    const key = expense.merchant.trim() || "—";
    const existing = byMerchant.get(key);
    if (existing) {
      existing.amount += expense.amount;
      existing.count += 1;
    } else {
      byMerchant.set(key, { merchant: key, amount: expense.amount, count: 1 });
    }
  }
  return [...byMerchant.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function averagePerDay(series: DayTotal[]): number {
  if (series.length === 0) return 0;
  const total = series.reduce((sum, entry) => sum + entry.amount, 0);
  return total / series.length;
}
