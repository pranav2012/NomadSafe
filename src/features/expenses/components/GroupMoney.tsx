import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraSection, Icon, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { isTrip, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { daysLeftInTrip } from "@/features/trips/utils/dates";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { categoryBreakdown, sumAmount } from "@/features/expenses/utils/aggregate";
import { formatMoney } from "@/features/expenses/utils/money";
import { myShareOf } from "@/features/expenses/utils/myMoney";
import { isSplitExpense } from "@/features/expenses/utils/split";
import { GroupActivity } from "@/features/expenses/components/GroupActivity";
import { GroupBalances } from "@/features/expenses/components/GroupBalances";
import { SpendHero } from "@/features/expenses/components/SpendHero";

/** Money for one trip or group: balances first when there are people, your spend, then activity by day. */
export function GroupMoney({
  group,
  onOpenExpense,
  onAddPeople,
  onImport,
}: {
  group: MoneyGroup;
  onOpenExpense: (expense: Expense) => void;
  onAddPeople: () => void;
  onImport: () => void;
}) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const allExpenses = useExpensesStore((state) => state.expenses);
  const allSettlements = useExpensesStore((state) => state.settlements);
  const expenses = useMemo(() => allExpenses.filter((expense) => expense.groupId === group.id), [allExpenses, group.id]);
  const settlements = useMemo(() => allSettlements.filter((settlement) => settlement.groupId === group.id), [allSettlements, group.id]);

  const conversion = useConvertedExpenses(expenses, group.currency);
  const convertedById = new Map(conversion.convertedExpenses.map(({ expense, amount }) => [expense.id, amount]));
  const rateOf = (expense: Expense) => (expense.amount > 0 ? (convertedById.get(expense.id) ?? 0) / expense.amount : 0);
  const converted = conversion.convertedExpenses.map(({ expense }) => expense);
  const mine: Expense[] = converted.map((expense) => ({ ...expense, amount: myShareOf(expense) * rateOf(expense), currency: group.currency }));
  const yourSpend = sumAmount(mine);
  const groupTotal = conversion.convertedExpenses.reduce((sum, entry) => sum + entry.amount, 0);
  const unconvertedLabel = conversion.unconvertedTotals.map((entry) => formatMoney(formatCurrency, entry.amount, entry.currency)).join(" + ");

  const hasPeople = group.companions.length > 0 || expenses.some(isSplitExpense) || settlements.length > 0;
  const trip = isTrip(group) ? group : null;

  return (
    <View>
      {hasPeople ? (
        <View style={styles.block}>
          <GroupBalances group={group} />
        </View>
      ) : null}

      <View style={hasPeople ? styles.spendAfterBalances : undefined}>
        <SpendHero
          label={hasPeople ? t("money.yourSpend") : trip ? null : group.name}
          currency={group.currency}
          total={yourSpend}
          daysLeft={trip ? daysLeftInTrip(trip) : 0}
          breakdown={categoryBreakdown(mine)}
          caption={hasPeople ? t("money.yourShareCaption") : undefined}
          detail={hasPeople && groupTotal > 0 ? t("money.groupTotal", { amount: formatMoney(formatCurrency, groupTotal, group.currency) }) : null}
          note={
            unconvertedLabel
              ? conversion.isConverting
                ? t("expenses.convertingAmounts", { amount: unconvertedLabel })
                : t("expenses.notConverted", { amount: unconvertedLabel })
              : null
          }
        />
      </View>

      {!hasPeople ? (
        <AuraCard style={styles.addPeople}>
          <View style={styles.addPeopleRow}>
            <Icon name="users" size={18} color={c.textSoft} />
            <Text style={[styles.addPeopleText, { color: c.textSoft, fontFamily: f.regular }]}>
              {trip ? t("money.addPeopleTrip") : t("money.addPeopleGroup")}
            </Text>
          </View>
          <AuraButton label={t("money.addPeople")} icon="plus" variant="secondary" size="md" onPress={onAddPeople} style={styles.addPeopleButton} />
        </AuraCard>
      ) : null}

      {expenses.length === 0 && settlements.length === 0 ? (
        <AuraCard style={styles.empty}>
          <Icon name="wallet" size={22} color={c.textSoft} />
          <Text style={[styles.emptyTitle, { color: c.text, fontFamily: f.semibold }]}>{t("expenses.noExpensesTitle")}</Text>
          <Text style={[styles.emptyBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("expenses.noExpensesBody")}</Text>
          <AuraButton label={t("expenses.importTitle")} icon="download" variant="secondary" size="md" onPress={onImport} style={styles.emptyButton} />
        </AuraCard>
      ) : (
        <>
          <AuraSection title={t("money.activity")} style={styles.section} />
          <GroupActivity
            expenses={expenses}
            settlements={settlements}
            convertedById={convertedById}
            displayCurrency={group.currency}
            showYourPart={hasPeople}
            onOpen={onOpenExpense}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 4 },
  spendAfterBalances: { marginTop: 28 },
  addPeople: { marginTop: 22, gap: 12 },
  addPeopleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  addPeopleText: { flex: 1, fontSize: 14, lineHeight: 20 },
  addPeopleButton: { alignSelf: "flex-start" },
  section: { marginTop: 26 },
  empty: { marginTop: 28, gap: 8 },
  emptyTitle: { fontSize: 18, marginTop: 4 },
  emptyBody: { fontSize: 14.5, lineHeight: 21 },
  emptyButton: { alignSelf: "flex-start", marginTop: 8 },
});
