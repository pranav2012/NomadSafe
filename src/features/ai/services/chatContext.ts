import { findMoneyGroup, isTrip, selectMoneyGroups, useTripsStore, type Group, type MoneyGroup, type Trip } from "@/features/trips/store/tripsStore";
import { useAiContextStore } from "@/features/ai/store/aiContextStore";
import { myShareOf, periodRange, inRange } from "@/features/expenses/utils/myMoney";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { computeNetBalances, isSplitExpense, roundMoney, SELF_ID, simplifyDebts } from "@/features/expenses/utils/split";
import { getDefaultCurrency } from "@/localization";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import {
  fetchExchangeRate,
  getCachedExchangeRate,
} from "@/features/expenses/services/currencyConversion";
import { getCurrentLocale } from "@/localization/translate";
import {
  computeMoneyFacts,
  formatDay,
  formatFactsBlock,
  formatMoney,
  tripDayProgress,
  type MoneyExpenseInput,
  type MoneyFacts,
} from "./moneyFacts";

import { chooseChatContext, GENERAL_CONTEXT, OVERVIEW_CONTEXT } from "../utils/chatContextChoice";

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
  forTrip?: Trip,
): Promise<TripMoneySnapshot | null> {
  const { trips, activeTripId } = useTripsStore.getState();
  const trip = forTrip ?? resolveContextTrip(trips, activeTripId);
  if (!trip) return null;

  const tripExpenses = useExpensesStore
    .getState()
    .expenses.filter((expense) => expense.groupId === trip.id);
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


export { chooseChatContext, GENERAL_CONTEXT, OVERVIEW_CONTEXT };

type ExpenseRecord = ReturnType<typeof useExpensesStore.getState>["expenses"][number];

export function resolveChatContext(): string {
  const { activeTripId, trips, groups } = useTripsStore.getState();
  const { expenses, settlements } = useExpensesStore.getState();
  return chooseChatContext({ picked: useAiContextStore.getState().picked, activeTripId, trips, groups, expenses, settlements });
}

const rateKey = (currency: string, date: string) => `${currency}|${toLocalDayKey(date)}`;

async function ratesTo(target: string, items: { currency: string; date: string }[]) {
  const rates = new Map<string, number>();
  for (const item of items) {
    const key = rateKey(item.currency, item.date);
    if (item.currency === target || rates.has(key)) continue;
    const rate = await rateWithin(item.currency, target, item.date);
    if (rate !== null) rates.set(key, rate);
  }
  return (currency: string, date: string) => (currency === target ? 1 : rates.get(rateKey(currency, date)) ?? null);
}

const who = (person: string) => (person === SELF_ID ? "you" : person);

/** Balances of a trip or group in its currency, already simplified, for the facts block. */
async function balanceLines(group: MoneyGroup, locale: string): Promise<string[]> {
  const { expenses, settlements } = useExpensesStore.getState();
  const split = expenses.filter((expense) => expense.groupId === group.id && isSplitExpense(expense));
  const payments = settlements.filter((settlement) => settlement.groupId === group.id);
  if (split.length === 0 && payments.length === 0) return ["- Balances: nothing has been split yet"];
  const rate = await ratesTo(group.currency, [...split, ...payments]);
  const { net, unconverted } = computeNetBalances(split, payments, (_, currency, date) => rate(currency, date));
  const money = (amount: number) => formatMoney(amount, group.currency, locale);
  const mine = roundMoney(net.get(SELF_ID) ?? 0, group.currency);
  const transfers = simplifyDebts(net, group.currency);
  const lines = [
    `- Your balance: ${mine > 0 ? `you are owed ${money(mine)}` : mine < 0 ? `you owe ${money(-mine)}` : "settled up"}`,
    transfers.length > 0
      ? `- Who pays whom to settle up (already simplified): ${transfers.map((transfer) => `${who(transfer.from)} pays ${who(transfer.to)} ${money(transfer.amount)}`).join("; ")}`
      : "- Everyone is settled up",
  ];
  if (unconverted > 0) lines.push(`- ${unconverted} entry(ies) left out of balances: exchange rate unavailable`);
  return lines;
}

/** Facts for a group (no travel details): totals, your share, categories, recent spends and balances. */
async function groupSnapshot(group: Group, now: Date, hideEmailMerchants: boolean) {
  const locale = getCurrentLocale();
  const money = (amount: number) => formatMoney(amount, group.currency, locale);
  const all = useExpensesStore.getState().expenses.filter((expense) => expense.groupId === group.id);
  const rate = await ratesTo(group.currency, all);
  let total = 0;
  let yours = 0;
  let unconverted = 0;
  const byCategory = new Map<string, number>();
  for (const expense of all) {
    const r = rate(expense.currency, expense.date);
    if (r === null) {
      unconverted += 1;
      continue;
    }
    total += expense.amount * r;
    yours += myShareOf(expense) * r;
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount * r);
  }
  const merchantOf = (expense: ExpenseRecord) => (hideEmailMerchants && expense.source === "email" ? expense.category : expense.merchant);
  const recent = [...all].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const lines = [
    "FACTS (computed exactly by the app; quote them verbatim and never recalculate):",
    `- Today: ${formatDay(now, locale)}`,
    `- Group (not a trip): ${group.name}; people: ${["you", ...group.companions].join(", ")}`,
    `- Currency: ${group.currency}`,
    `- Spent in total by everyone: ${money(total)} across ${all.length} expense(s)`,
    `- Your share of that spending: ${money(yours)}`,
  ];
  if (byCategory.size > 0) {
    lines.push(`- Spend by category: ${[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([category, amount]) => `${category} ${money(amount)}`).join("; ")}`);
  }
  if (recent.length > 0) {
    lines.push(
      `- Latest expenses: ${recent
        .map((expense) => `${merchantOf(expense)} ${formatMoney(expense.amount, expense.currency, locale)} on ${toLocalDayKey(expense.date)}${expense.shares?.length ? `, split ${expense.shares.length} ways` : ", just for one person"}`)
        .join("; ")}`,
    );
  }
  if (unconverted > 0) lines.push(`- ${unconverted} expense(s) left out of totals: exchange rate unavailable`);
  lines.push(...(await balanceLines(group, locale)));
  return { context: lines.join("\n"), locale };
}

/** Facts across everything: this month's spending (your share), where it went, and your balance in each trip or group. */
async function overviewSnapshot(now: Date) {
  const locale = getCurrentLocale();
  const home = getDefaultCurrency();
  const money = (amount: number) => formatMoney(amount, home, locale);
  const state = useTripsStore.getState();
  const groups = selectMoneyGroups(state);
  const { expenses } = useExpensesStore.getState();
  const month = periodRange("month", 0, now);
  const inMonth = expenses.filter((expense) => inRange(expense.date, month));
  const rate = await ratesTo(home, inMonth);
  let spent = 0;
  const bySource = new Map<string, number>();
  for (const expense of inMonth) {
    const r = rate(expense.currency, expense.date);
    if (r === null) continue;
    const amount = myShareOf(expense) * r;
    spent += amount;
    const name = groups.find((group) => group.id === expense.groupId)?.name ?? "not in any group";
    bySource.set(name, (bySource.get(name) ?? 0) + amount);
  }
  const lines = [
    "FACTS (computed exactly by the app; quote them verbatim and never recalculate):",
    `- Today: ${formatDay(now, locale)}`,
    `- Your spending this month (your share of split expenses plus your own spends, in ${home}): ${money(spent)}`,
  ];
  if (bySource.size > 0) {
    lines.push(`- Where it went this month: ${[...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => `${name} ${money(amount)}`).join("; ")}`);
  }
  for (const group of groups.filter((item) => !item.shared?.archived)) {
    const balance = await balanceLines(group, locale);
    lines.push(`- ${isTrip(group) ? "Trip" : "Group"} "${group.name}" (${group.currency}): ${balance.map((line) => line.replace(/^- /, "")).join(" | ")}`);
  }
  return { context: lines.join("\n"), locale };
}

/** The money facts for a chat context, or null for the general chat. */
export async function loadChatSnapshot(
  contextId: string,
  now: Date = new Date(),
  { hideEmailMerchants = false }: { hideEmailMerchants?: boolean } = {},
): Promise<{ context: string; locale: string } | null> {
  if (contextId === GENERAL_CONTEXT) return null;
  if (contextId === OVERVIEW_CONTEXT) return overviewSnapshot(now);
  const group = findMoneyGroup(useTripsStore.getState(), contextId);
  if (!group) return null;
  if (!isTrip(group)) return groupSnapshot(group, now, hideEmailMerchants);
  const snapshot = await loadTripMoneySnapshot(now, { hideEmailMerchants }, group);
  if (!snapshot) return null;
  const balances = await balanceLines(group, snapshot.locale);
  return { context: [snapshot.context, ...balances].join("\n"), locale: snapshot.locale };
}

