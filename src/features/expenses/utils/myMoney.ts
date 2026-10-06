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

export type SpendPeriod = "week" | "month";

/** Week (Monday first) or month `offset` periods back from `now`; end is exclusive. */
export function periodRange(period: SpendPeriod, offset: number, now: Date = new Date()): { start: Date; end: Date } {
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
