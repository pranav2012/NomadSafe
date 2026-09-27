import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney as formatSharedMoney } from "@/features/expenses/utils/money";

export type MoneyIntent = "dailyBudget" | "remaining" | "spent" | "topCategory" | "afford" | "overBudget";

export type TripDayStatus = "upcoming" | "active" | "complete";

export type Translator = (key: string, params?: Record<string, string | number>) => string;

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

export interface MoneyIntentMatch {
  intent: MoneyIntent;
  amount: number | null;
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

/** First amount in free text ("50", "€12.50", "1,200", "1.200,50", "2k"), or null. */
export function parseAmount(text: string): number | null {
  const match = /(\d+(?:[.,\s]\d+)*)\s*(k\b)?/i.exec(text);
  if (!match) return null;
  let raw = match[1].replace(/\s/g, "");
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    raw = raw.split(thousands).join("").replace(decimal, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? "." : ",";
    const parts = raw.split(separator);
    const isDecimal = parts.length === 2 && parts[1].length <= 2;
    raw = isDecimal ? parts.join(".") : parts.join("");
  }
  const value = Number(raw) * (match[2] ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Matches English money questions; `affordPrefix` (localized chip text) works in any language. */
export function matchMoneyIntent(text: string, affordPrefix?: string): MoneyIntentMatch | null {
  const raw = text.trim();
  const q = raw.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  if (!q) return null;
  const prefix = affordPrefix?.trim().toLowerCase().replace(/[…]+$|\.+$/, "").trim();

  if ((prefix && q.startsWith(prefix)) || /\b(can|could|should) (i|we) (still )?(afford|buy|pay for|spend)\b/.test(q)) {
    const amount = parseAmount(raw);
    const isAffordQuestion = /\bafford\b/.test(q) || (prefix !== undefined && q.startsWith(prefix));
    if (amount !== null && (isAffordQuestion || /\b(can|could|should) (i|we) (still )?(buy|pay for|spend)\b/.test(q))) {
      return { intent: "afford", amount };
    }
    if (isAffordQuestion) return { intent: "afford", amount: null };
  }

  const pastTense = /\b(did|have|has|had) (i|we)\b|\bso far\b|\baverage\b|\busually\b/.test(q);
  const perDay = /\b(per|a|each|every) day\b|\bdaily\b|\bper diem\b|\/ ?day\b|\ba day\b/.test(q);
  if (perDay && !pastTense && /\b(spend|budget|afford|allowance|left|can|limit|safe|money)\b/.test(q)) {
    return { intent: "dailyBudget", amount: null };
  }

  if (
    /\bover (my |the |our )?budget\b|\bon track\b|\b(within|under|in) (my |the |our )?budget\b|\bover ?spending\b|\bam i overspending\b/.test(q) &&
    !/\bwhere\b/.test(q)
  ) {
    return { intent: "overBudget", amount: null };
  }

  if (/\b(left|remaining|remain|leftover)\b/.test(q) && /\b(how much|what'?s|what is|budget|money|have|got|is there)\b/.test(q)) {
    return { intent: "remaining", amount: null };
  }

  if (
    /\b(top|biggest|largest|highest|main|most) (spending|spend|expense|category|categories)\b/.test(q) ||
    /\bspen[dt] (the )?most (on|money)\b/.test(q) ||
    /\bwhere (does|did|is) (my|our|the) money go/.test(q) ||
    /\b(top|biggest|largest) .*categor/.test(q)
  ) {
    return { intent: "topCategory", amount: null };
  }

  if (
    /\bhow much (have|did|had) (i|we) (spent|spend)\b|\bhow much (i|we)(('ve)| have)? spent\b|\btotal (spend|spent|spending)\b|\bspent so far\b|\bwhat have (i|we) spent\b/.test(q)
  ) {
    return { intent: "spent", amount: null };
  }

  return null;
}

function categoryLabel(category: string, t: Translator): string {
  const key = `expenses.category.${category}`;
  const label = t(key);
  return label === key ? category : label;
}

/** Deterministic, localized reply for a matched money intent. */
export function answerMoneyIntent(
  match: MoneyIntentMatch,
  facts: MoneyFacts | null,
  t: Translator,
  locale: string,
): string {
  if (!facts) return t("aiTab.answer.noTrip");
  const money = (amount: number) => formatMoney(amount, facts.currency, locale);
  const budget = money(facts.budget);
  const over = money(Math.abs(facts.remaining));
  const lines: string[] = [];

  const needsBudget = match.intent !== "spent" && match.intent !== "topCategory";
  if (needsBudget && !facts.hasBudget) {
    lines.push(t("aiTab.answer.noBudget", { spent: money(facts.spent) }));
  } else {
    switch (match.intent) {
      case "dailyBudget":
        if (facts.status === "complete") {
          lines.push(
            facts.remaining >= 0
              ? t("aiTab.answer.dailyEnded", { remaining: money(facts.remaining) })
              : t("aiTab.answer.dailyEndedOver", { over }),
          );
        } else if (facts.remaining <= 0) {
          lines.push(t("aiTab.answer.dailyOver", { over, budget, count: facts.daysLeft }));
        } else {
          lines.push(
            t("aiTab.answer.daily", {
              perDay: money(facts.safeDailySpend ?? 0),
              remaining: money(facts.remaining),
              count: facts.daysLeft,
            }),
          );
          if (facts.plannedDailyBudget !== null) {
            lines.push(t("aiTab.answer.dailyPlanned", { planned: money(facts.plannedDailyBudget) }));
          }
        }
        break;
      case "remaining":
        lines.push(
          facts.remaining >= 0
            ? t("aiTab.answer.remaining", { remaining: money(facts.remaining), budget, spent: money(facts.spent) })
            : t("aiTab.answer.remainingOver", { over, budget, spent: money(facts.spent) }),
        );
        if (facts.safeDailySpend !== null && facts.remaining > 0) {
          lines.push(t("aiTab.answer.perDayHint", { perDay: money(facts.safeDailySpend), count: facts.daysLeft }));
        }
        break;
      case "spent":
        if (facts.expenseCount === 0) {
          lines.push(t("aiTab.answer.noExpenses"));
        } else {
          lines.push(t("aiTab.answer.spent", { spent: money(facts.spent), count: facts.expenseCount }));
          if (facts.status === "active") lines.push(t("aiTab.answer.spentToday", { today: money(facts.todaySpent) }));
          if (facts.hasBudget) {
            lines.push(
              facts.remaining >= 0
                ? t("aiTab.answer.spentOfBudget", { budget, remaining: money(facts.remaining) })
                : t("aiTab.answer.spentOverBudget", { budget, over }),
            );
          }
        }
        break;
      case "topCategory": {
        const [top, ...rest] = facts.categories;
        if (!top) {
          lines.push(t("aiTab.answer.noExpenses"));
          break;
        }
        lines.push(
          t("aiTab.answer.topCategory", {
            category: categoryLabel(top.category, t),
            amount: money(top.amount),
            percent: top.percent,
          }),
        );
        if (rest.length) {
          lines.push(
            t("aiTab.answer.topCategoryRest", {
              list: rest
                .slice(0, 2)
                .map((entry) => `${categoryLabel(entry.category, t)} ${money(entry.amount)}`)
                .join(", "),
            }),
          );
        }
        if (facts.merchants[0]) {
          lines.push(
            t("aiTab.answer.topMerchant", {
              merchant: facts.merchants[0].merchant,
              amount: money(facts.merchants[0].amount),
            }),
          );
        }
        break;
      }
      case "afford": {
        if (match.amount === null) {
          lines.push(t("aiTab.answer.affordNoAmount"));
          break;
        }
        const amount = money(match.amount);
        const after = roundMoney(facts.remaining - match.amount);
        if (facts.remaining <= 0) {
          lines.push(t("aiTab.answer.affordAlreadyOver", { amount, over }));
        } else if (after >= 0) {
          lines.push(t("aiTab.answer.affordYes", { amount, after: money(after) }));
          if (facts.daysLeft > 0) {
            lines.push(
              t("aiTab.answer.perDayHint", {
                perDay: money(roundMoney(after / facts.daysLeft)),
                count: facts.daysLeft,
              }),
            );
          }
        } else {
          lines.push(t("aiTab.answer.affordNo", { amount, remaining: money(facts.remaining), short: money(-after) }));
        }
        break;
      }
      case "overBudget":
        if (facts.remaining < 0) {
          lines.push(t("aiTab.answer.overBudgetYes", { over, budget, spent: money(facts.spent) }));
        } else {
          lines.push(
            t("aiTab.answer.overBudgetNo", { spent: money(facts.spent), budget, remaining: money(facts.remaining) }),
          );
          if (
            facts.status === "active" &&
            facts.averageDailySpend !== null &&
            facts.plannedDailyBudget !== null &&
            facts.averageDailySpend > facts.plannedDailyBudget
          ) {
            lines.push(
              t("aiTab.answer.paceAhead", {
                average: money(facts.averageDailySpend),
                planned: money(facts.plannedDailyBudget),
              }),
            );
          }
        }
        break;
    }
  }

  if (facts.unconvertedCount > 0) {
    lines.push(t("aiTab.answer.unconverted", { count: facts.unconvertedCount }));
  }
  return lines.join(" ");
}
