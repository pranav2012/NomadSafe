import { useMemo } from "react";
import type { GroupBase } from "@/features/trips/store/tripsStore";
import { useExpensesStore } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { computeNetBalances, currencyFractionDigits, isSplitExpense, roundMoney, SELF_ID, simplifyDebts } from "@/features/expenses/utils/split";

const rateKey = (currency: string, date: string) => `${currency}|${toLocalDayKey(date)}`;

/** Balances of a trip or group in its currency: everyone's net, simplified transfers and yours. */
export function useGroupBalances(group: Pick<GroupBase, "id" | "currency" | "companions">) {
  const allExpenses = useExpensesStore((state) => state.expenses);
  const allSettlements = useExpensesStore((state) => state.settlements);
  const splitExpenses = useMemo(
    () => allExpenses.filter((expense) => expense.groupId === group.id && isSplitExpense(expense)),
    [allExpenses, group.id],
  );
  const settlements = useMemo(() => allSettlements.filter((settlement) => settlement.groupId === group.id), [allSettlements, group.id]);
  const convertedExpenses = useConvertedExpenses(splitExpenses, group.currency);
  const convertedSettlements = useConvertedExpenses(settlements, group.currency);

  const rates = new Map<string, number>();
  for (const entry of [...convertedExpenses.convertedExpenses, ...convertedSettlements.convertedExpenses]) {
    if (entry.expense.amount > 0) rates.set(rateKey(entry.expense.currency, entry.expense.date), entry.amount / entry.expense.amount);
  }
  const { net, unconverted } = computeNetBalances(splitExpenses, settlements, (_, currency, date) =>
    currency === group.currency ? 1 : rates.get(rateKey(currency, date)) ?? null,
  );
  // A single minor unit (₹0.01) is left by rounding in other apps' exports, not a real debt.
  const minorUnit = 10 ** -currencyFractionDigits(group.currency);
  const transfers = simplifyDebts(net, group.currency).filter((transfer) => transfer.amount > minorUnit + 1e-9);
  const rawNet = roundMoney(net.get(SELF_ID) ?? 0, group.currency);
  const myNet = Math.abs(rawNet) <= minorUnit + 1e-9 ? 0 : rawNet;
  const everyone = [...new Set([SELF_ID, ...group.companions, ...net.keys()])];
  return { net, transfers, myNet, unconverted, everyone, splitExpenses, settlements };
}
