import { useMemo } from "react";
import { useLocalization } from "@/localization";
import { isArchivedGroup, selectMoneyGroups, useTripsStore, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useRateRequests } from "@/features/expenses/hooks/useTripExpenseSummary";
import { converterFrom, rateKey } from "@/features/expenses/utils/rates";
import { computeNetBalances, isSplitExpense, myNetOf, roundMoney, SELF_ID } from "@/features/expenses/utils/split";

export interface GroupBalanceRow {
  group: MoneyGroup;
  /** Your balance in the home currency. */
  net: number;
  /** Your balance in the group's own currency. */
  myNet: number;
  hasSplits: boolean;
  unconverted: number;
  lastActivity: number;
}

/**
 * Your balance in every trip and group and overall (archived ones left out), in your currency;
 * `ready` once rates are in. `archivedRows` carry the archived ones for their own list.
 */
export function useOverallBalance() {
  const { currency: homeCurrency } = useLocalization();
  const groups = useTripsStore(selectMoneyGroups);
  const expenses = useExpensesStore((state) => state.expenses);
  const settlements = useExpensesStore((state) => state.settlements);
  const splitItems = useMemo(() => [...expenses.filter((expense) => expense.groupId && isSplitExpense(expense)), ...settlements], [expenses, settlements]);
  const requests = useMemo(() => {
    const currencyOf = new Map(groups.map((group) => [group.id, group.currency]));
    return splitItems.flatMap((item) => {
      const own = currencyOf.get(item.groupId ?? "");
      const home = { currency: item.currency, target: homeCurrency, date: item.date };
      return own && own !== homeCurrency ? [home, { currency: item.currency, target: own, date: item.date }] : [home];
    });
  }, [groups, splitItems, homeCurrency]);
  const { rates } = useRateRequests(requests);
  const toHome = converterFrom(rates, homeCurrency);

  const all: GroupBalanceRow[] = groups
    .map((group) => {
      const groupExpenses = expenses.filter((expense) => expense.groupId === group.id);
      const groupSettlements = settlements.filter((settlement) => settlement.groupId === group.id);
      const groupSplits = groupExpenses.filter(isSplitExpense);
      const { net, unconverted } = computeNetBalances(groupSplits, groupSettlements, toHome);
      const own = group.currency === homeCurrency ? net : computeNetBalances(groupSplits, groupSettlements, converterFrom(rates, group.currency)).net;
      const dates = [...groupExpenses.map((expense) => expense.date), ...groupSettlements.map((settlement) => settlement.date), group.createdAt];
      return {
        group,
        net: roundMoney(net.get(SELF_ID) ?? 0, homeCurrency),
        myNet: myNetOf(own, group.currency),
        hasSplits: groupSplits.length > 0 || groupSettlements.length > 0,
        unconverted,
        lastActivity: Math.max(...dates.map((date) => new Date(date).getTime())),
      };
    })
    .sort((a, b) => b.lastActivity - a.lastActivity);
  const rows = all.filter((row) => !isArchivedGroup(row.group));

  return {
    rows,
    archivedRows: groups.filter(isArchivedGroup).map((group) => all.find((row) => row.group.id === group.id)!),
    overall: roundMoney(rows.reduce((sum, row) => sum + row.net, 0), homeCurrency),
    currency: homeCurrency,
    ready: splitItems.every((item) => item.currency === homeCurrency || rateKey(item.currency, homeCurrency, item.date) in rates),
  };
}
