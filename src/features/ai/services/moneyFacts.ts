import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney as formatSharedMoney } from "@/features/expenses/utils/money";

export type TripDayStatus = "upcoming" | "active" | "complete";

export interface MoneyTripInput {
  name: string;
  destinations: string[];
  startDate: string;
  endDate: string;
  budget: number;
  currency: string;
  mode: string;
  companions: string[];
}

/** An expense whose amount is already converted to the trip currency. */
export interface MoneyExpenseInput {
  amount: number;
  category: string;
  merchant: string;
  date: string;
}

export interface MoneyFactsInput {
  trip: MoneyTripInput;
  expenses: MoneyExpenseInput[];
  unconvertedCount: number;
  now: Date;
}

export interface TripDayProgress {
  status: TripDayStatus;
  totalDays: number;
  /** Trip days up to and including today (0 before the trip, totalDays after it). */
  daysElapsed: number;
  /** Trip days from today through the last day, including today (0 once ended). */
  daysLeft: number;
}

export interface MoneyFacts extends TripDayProgress {
  trip: MoneyTripInput;
  currency: string;
  todayKey: string;
  hasBudget: boolean;
  budget: number;
  spent: number;
  /** Negative when over budget. */
  remaining: number;
  plannedDailyBudget: number | null;
  safeDailySpend: number | null;
  averageDailySpend: number | null;
  projectedTotal: number | null;
  todaySpent: number;
  expenseCount: number;
  unconvertedCount: number;
  categories: { category: string; amount: number; percent: number }[];
  merchants: { merchant: string; amount: number; count: number }[];
  largestExpense: MoneyExpenseInput | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDayKey(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Where today sits in the trip, on local calendar days (inclusive of start, end and today). */
export function tripDayProgress(trip: { startDate: string; endDate: string }, now: Date): TripDayProgress {
  const start = parseDayKey(trip.startDate);
  const end = parseDayKey(trip.endDate);
  const today = startOfDay(now);
  const totalDays = Math.max(1, dayDiff(start, end) + 1);

  if (today < start) return { status: "upcoming", totalDays, daysElapsed: 0, daysLeft: totalDays };
  if (today > end) return { status: "complete", totalDays, daysElapsed: totalDays, daysLeft: 0 };
  const daysElapsed = Math.min(totalDays, dayDiff(start, today) + 1);
  return { status: "active", totalDays, daysElapsed, daysLeft: totalDays - daysElapsed + 1 };
}

/** Computes every money figure the assistant may quote, so the model never does arithmetic. */
export function computeMoneyFacts({ trip, expenses, unconvertedCount, now }: MoneyFactsInput): MoneyFacts {
  const progress = tripDayProgress(trip, now);
  const todayKey = toLocalDayKey(now);
  // Same rule as hasTripBudget (tripsStore), kept local so this module stays store-free.
  const hasBudget = Number.isFinite(trip.budget) && trip.budget > 0;
  const spent = roundMoney(expenses.reduce((sum, expense) => sum + expense.amount, 0));
  const remaining = roundMoney(trip.budget - spent);

  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { merchant: string; amount: number; count: number }>();
  let todaySpent = 0;
  let largestExpense: MoneyExpenseInput | null = null;
  for (const expense of expenses) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
    const name = expense.merchant.trim();
    if (name) {
      const key = name.toLowerCase();
      const entry = byMerchant.get(key) ?? { merchant: name, amount: 0, count: 0 };
      entry.amount += expense.amount;
      entry.count += 1;
      byMerchant.set(key, entry);
    }
    if (toLocalDayKey(expense.date) === todayKey) todaySpent += expense.amount;
    if (!largestExpense || expense.amount > largestExpense.amount) largestExpense = expense;
  }

  const averageDailySpend = progress.daysElapsed > 0 ? roundMoney(spent / progress.daysElapsed) : null;

  return {
    ...progress,
    trip,
    currency: trip.currency,
    todayKey,
    hasBudget,
    budget: trip.budget,
    spent,
    remaining,
    plannedDailyBudget: hasBudget ? roundMoney(trip.budget / progress.totalDays) : null,
    safeDailySpend:
      hasBudget && progress.daysLeft > 0 ? roundMoney(Math.max(0, remaining) / progress.daysLeft) : null,
    averageDailySpend,
    projectedTotal:
      progress.status === "active" && averageDailySpend !== null
        ? roundMoney((spent / progress.daysElapsed) * progress.totalDays)
        : null,
    todaySpent: roundMoney(todaySpent),
    expenseCount: expenses.length,
    unconvertedCount,
    categories: [...byCategory.entries()]
      .map(([category, amount]) => ({
        category,
        amount: roundMoney(amount),
        percent: spent > 0 ? Math.round((amount / spent) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5),
    merchants: [...byMerchant.values()]
      .map((entry) => ({ ...entry, amount: roundMoney(entry.amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 3),
    largestExpense,
  };
}

/** Trip-currency amount with cents only when present, matching Home and Money. */
export function formatMoney(amount: number, currency: string, locale: string): string {
  const intlFormat = (value: number, code = currency, options?: Intl.NumberFormatOptions) => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: code, ...options }).format(value);
    } catch {
      return `${code} ${value.toFixed(2)}`;
    }
  };
  return formatSharedMoney(intlFormat, amount, currency);
}

function formatDay(value: string | Date, locale: string): string {
  const date = typeof value === "string" ? parseDayKey(toLocalDayKey(value)) : value;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  } catch {
    return toLocalDayKey(date);
  }
}

/** Compact, labelled FACTS block for the system prompt. */
export function formatFactsBlock(facts: MoneyFacts, locale: string, now: Date): string {
  const money = (amount: number) => formatMoney(amount, facts.currency, locale);
  const { trip } = facts;
  const travelers =
    trip.mode === "group"
      ? `group of ${trip.companions.length + 1}${trip.companions.length ? ` (${trip.companions.join(", ")})` : ""}`
      : "solo";
  const statusLine =
    facts.status === "active"
      ? `active, day ${facts.daysElapsed} of ${facts.totalDays}`
      : facts.status === "upcoming"
        ? `upcoming, starts in ${dayDiff(now, parseDayKey(trip.startDate))} day(s)`
        : "ended";

  const lines = [
    "FACTS (computed exactly by the app; quote them verbatim and never recalculate):",
    `- Today: ${formatDay(now, locale)} (${facts.todayKey})`,
    `- Trip: ${trip.name}; destinations: ${trip.destinations.join(", ") || "not set"}; travelers: ${travelers}`,
    `- Trip dates: ${formatDay(trip.startDate, locale)} to ${formatDay(trip.endDate, locale)} (${facts.totalDays} days)`,
    `- Trip status: ${statusLine}`,
    `- Days left including today: ${facts.daysLeft}`,
    `- Currency: ${facts.currency}`,
    facts.hasBudget
      ? `- Budget: ${money(facts.budget)}`
      : "- Budget: none set (there is no remaining amount, daily limit, or over/under budget for this trip)",
    `- Spent so far: ${money(facts.spent)} across ${facts.expenseCount} expense(s)`,
  ];

  if (facts.hasBudget) {
    lines.push(
      facts.remaining >= 0
        ? `- Remaining: ${money(facts.remaining)}`
        : `- Over budget by: ${money(-facts.remaining)} (remaining: ${money(0)})`,
    );
    if (facts.plannedDailyBudget !== null) lines.push(`- Planned daily budget: ${money(facts.plannedDailyBudget)}`);
    lines.push(
      facts.safeDailySpend !== null
        ? `- Safe daily spend for the ${facts.daysLeft} day(s) left: ${money(facts.safeDailySpend)}`
        : "- Safe daily spend: not applicable (trip ended)",
    );
  }
  if (facts.averageDailySpend !== null) lines.push(`- Average daily spend so far: ${money(facts.averageDailySpend)}`);
  if (facts.projectedTotal !== null) lines.push(`- Projected trip total at current pace: ${money(facts.projectedTotal)}`);
  lines.push(`- Spent today: ${money(facts.todaySpent)}`);
  if (facts.categories.length) {
    lines.push(
      `- Spend by category: ${facts.categories
        .map((entry) => `${entry.category} ${money(entry.amount)} (${entry.percent}%)`)
        .join("; ")}`,
    );
  }
  if (facts.merchants.length) {
    lines.push(
      `- Top merchants: ${facts.merchants
        .map((entry) => `${entry.merchant} ${money(entry.amount)} (${entry.count}x)`)
        .join("; ")}`,
    );
  }
  if (facts.largestExpense) {
    lines.push(
      `- Largest expense: ${facts.largestExpense.merchant || facts.largestExpense.category} ${money(
        facts.largestExpense.amount,
      )} on ${formatDay(facts.largestExpense.date, locale)}`,
    );
  }
  if (facts.unconvertedCount > 0) {
    lines.push(`- Not included yet (exchange rate unavailable): ${facts.unconvertedCount} expense(s)`);
  }
  return lines.join("\n");
}
