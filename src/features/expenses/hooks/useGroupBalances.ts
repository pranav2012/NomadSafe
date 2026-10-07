import { useMemo } from "react";
import type { GroupBase } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useRateRequests } from "@/features/expenses/hooks/useTripExpenseSummary";
import { converterFrom } from "@/features/expenses/utils/rates";
import { computeNetBalances, currencyFractionDigits, isSplitExpense, myNetOf, pairwiseDebts, SELF_ID, simplifyDebts } from "@/features/expenses/utils/split";

/** Balances of a trip or group in its currency: everyone's net, simplified transfers and yours. */
export function useGroupBalances(group: Pick<GroupBase, "id" | "currency" | "companions" | "smartSplit">) {
  const allExpenses = useExpensesStore((state) => state.expenses);
  const allSettlements = useExpensesStore((state) => state.settlements);
  const splitExpenses = useMemo(
    () => allExpenses.filter((expense) => expense.groupId === group.id && isSplitExpense(expense)),
    [allExpenses, group.id],
  );
  const settlements = useMemo(() => allSettlements.filter((settlement) => settlement.groupId === group.id), [allSettlements, group.id]);
  const requests = useMemo(
    () => [...splitExpenses, ...settlements].map((item) => ({ currency: item.currency, target: group.currency, date: item.date })),
    [splitExpenses, settlements, group.currency],
  );
  const { rates } = useRateRequests(requests);

  const convert = converterFrom(rates, group.currency);
  const { net, unconverted } = computeNetBalances(splitExpenses, settlements, convert);
  // A single minor unit (₹0.01) is left by rounding in other apps' exports, not a real debt.
  const minorUnit = 10 ** -currencyFractionDigits(group.currency);
  const all = group.smartSplit === false ? pairwiseDebts(splitExpenses, settlements, convert, group.currency) : simplifyDebts(net, group.currency);
  const transfers = all.filter((transfer) => transfer.amount > minorUnit + 1e-9);
  const myNet = myNetOf(net, group.currency);
  const everyone = [...new Set([SELF_ID, ...group.companions, ...net.keys()])];
  return { net, transfers, myNet, unconverted, everyone, splitExpenses, settlements };
}
