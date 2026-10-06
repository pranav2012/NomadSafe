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

export interface MerchantTotal {
  merchant: string;
  amount: number;
  count: number;
}

export function filterByGroup(expenses: Expense[], groupId: string | null): Expense[] {
  if (!groupId) return expenses;
  return expenses.filter((expense) => expense.groupId === groupId);
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
