import { useMemo } from "react";
import { useLocalization } from "@/localization";
import { isArchivedGroup, selectMoneyGroups, useTripsStore, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { computeNetBalances, isSplitExpense, roundMoney, SELF_ID } from "@/features/expenses/utils/split";

export interface GroupBalanceRow {
  group: MoneyGroup;
  /** Your balance in the home currency. */
  net: number;
  unconverted: number;
  lastActivity: number;
}

const rateKey = (currency: string, date: string) => `${currency}|${toLocalDayKey(date)}`;

/** Your balance in every (not archived) trip and group and overall, in your currency; `ready` once rates are in. */
export function useOverallBalance() {
  const { currency: homeCurrency } = useLocalization();
  const groups = useTripsStore(selectMoneyGroups);
  const expenses = useExpensesStore((state) => state.expenses);
  const settlements = useExpensesStore((state) => state.settlements);
  const splitItems = useMemo(() => [...expenses.filter((expense) => expense.groupId && isSplitExpense(expense)), ...settlements], [expenses, settlements]);
  const conversion = useConvertedExpenses(splitItems, homeCurrency);
  const rates = new Map<string, number>();
  for (const entry of conversion.convertedExpenses) {
    if (entry.expense.amount > 0) rates.set(rateKey(entry.expense.currency, entry.expense.date), entry.amount / entry.expense.amount);
  }
  const convert = (_: number, currency: string, date: string) => (currency === homeCurrency ? 1 : rates.get(rateKey(currency, date)) ?? null);

  const rows: GroupBalanceRow[] = groups
    .filter((group) => !isArchivedGroup(group))
    .map((group) => {
      const groupExpenses = expenses.filter((expense) => expense.groupId === group.id);
      const groupSettlements = settlements.filter((settlement) => settlement.groupId === group.id);
      const { net, unconverted } = computeNetBalances(groupExpenses.filter(isSplitExpense), groupSettlements, convert);
      const dates = [...groupExpenses.map((expense) => expense.date), ...groupSettlements.map((settlement) => settlement.date), group.createdAt];
      return { group, net: roundMoney(net.get(SELF_ID) ?? 0, homeCurrency), unconverted, lastActivity: Math.max(...dates.map((date) => new Date(date).getTime())) };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);

  return {
    rows,
    overall: roundMoney(rows.reduce((sum, row) => sum + row.net, 0), homeCurrency),
    currency: homeCurrency,
    ready: !conversion.isConverting && conversion.unconvertedTotals.length === 0,
  };
}
