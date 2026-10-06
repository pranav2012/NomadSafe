import { payersOf, SELF_ID, type ExpensePayer, type ExpenseShare } from "./split";

interface MoneyExpense {
  amount: number;
  date: string;
  paidBy?: string;
  payers?: ExpensePayer[];
  shares?: ExpenseShare[];
}

/** Your share of a split expense (whoever paid), else the whole amount; settlements are never spending. */
export function myShareOf(expense: MoneyExpense): number {
  if (expense.shares && expense.shares.length > 0) {
    return expense.shares.filter((share) => share.person === SELF_ID).reduce((sum, share) => sum + share.amount, 0);
  }
  return expense.amount;
}

export function myPaidOf(expense: MoneyExpense): number {
  return payersOf(expense).filter((payer) => payer.person === SELF_ID).reduce((sum, payer) => sum + payer.amount, 0);
}

/** Positive when you lent on a split expense, negative when you borrowed; null when it isn't split. */
export function myLentOf(expense: MoneyExpense): number | null {
  if (!expense.shares || expense.shares.length === 0) return null;
  return myPaidOf(expense) - myShareOf(expense);
}

export type SpendPeriod = "week" | "month" | "year";

/** Week (Monday first), month or year `offset` periods back from `now`; end is exclusive. */
export function periodRange(period: SpendPeriod, offset: number, now: Date = new Date()): { start: Date; end: Date } {
  if (period === "year") {
    const start = new Date(now.getFullYear() - offset, 0, 1);
    return { start, end: new Date(start.getFullYear() + 1, 0, 1) };
  }
  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sinceMonday = (today.getDay() + 6) % 7;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - sinceMonday - offset * 7);
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
}

export function inRange(date: string, range: { start: Date; end: Date }): boolean {
  const time = new Date(date).getTime();
  return time >= range.start.getTime() && time < range.end.getTime();
}

/** Totals per calendar month for the last `months` months (oldest first), from amounts already in one currency. */
export function monthlyTotals(items: { amount: number; date: string }[], months: number, now: Date = new Date()): { start: Date; total: number }[] {
  const buckets = Array.from({ length: months }, (_, index) => ({ ...periodRange("month", months - 1 - index, now), total: 0 }));
  for (const item of items) {
    const bucket = buckets.find((entry) => inRange(item.date, entry));
    if (bucket) bucket.total += item.amount;
  }
  return buckets.map(({ start, total }) => ({ start, total }));
}
