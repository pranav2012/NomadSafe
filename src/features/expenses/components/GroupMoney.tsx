import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraEmptyState, AuraSection, Icon, useAura } from "@/atoms";
import { auraSpace } from "@/constants/aura";
import { ExportSheet } from "@/features/expenses/components/ExportSheet";
import { useLocalization } from "@/localization";
import { isTrip, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { daysLeftInTrip, getTripStatus } from "@/features/trips/utils/dates";
import { useKeepGroupStore } from "@/features/expenses/store/keepGroupStore";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { categoryBreakdown, sumAmount } from "@/features/expenses/utils/aggregate";
import { formatMoney } from "@/features/expenses/utils/money";
import { myShareOf } from "@/features/expenses/utils/myMoney";
import { isSplitExpense } from "@/features/expenses/utils/split";
import { GroupActivity } from "@/features/expenses/components/GroupActivity";
import { RecurringList } from "@/features/expenses/components/RecurringList";
import { GroupBalances } from "@/features/expenses/components/GroupBalances";
import { SpendHero } from "@/features/expenses/components/SpendHero";
import { GroupPlaces, TripPaceCard } from "@/features/expenses/components/SpendCharts";
import { TripForex } from "@/features/expenses/components/TripForex";
import { pocketOfForexSpend } from "@/features/expenses/services/forexPockets";
import { useForexSheetStore } from "@/features/expenses/store/forexSheetStore";
import { usePocketsStore } from "@/features/expenses/store/pocketsStore";

/** Money for one trip or group: balances first when there are people, your spend, then activity by day. */
export function GroupMoney({
  group,
  onOpenExpense,
  onAddPeople,
  onImport,
  onPlanTrip,
  onKeepAsGroup,
  exportOpen,
  onCloseExport,
  recording,
  onRecordingDone,
}: {
  group: MoneyGroup;
  onOpenExpense: (expense: Expense) => void;
  onAddPeople: () => void;
  onImport: () => void;
  onPlanTrip: () => void;
  onKeepAsGroup: () => void;
  exportOpen: boolean;
  onCloseExport: () => void;
  recording: boolean;
  onRecordingDone: () => void;
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
  const hasActivity = expenses.length > 0 || settlements.length > 0;
  const trip = isTrip(group) ? group : null;
  const keepHandled = useKeepGroupStore((state) => (trip ? state.handled.includes(trip.id) : true));
  const showKeep = !!trip && !keepHandled && trip.companions.length > 0 && getTripStatus(trip) === "complete";
  // Fees, untracked cash and leftovers belong to their pocket, so they open it rather than the spend form.
  const openExpense = (expense: Expense) => {
    const pocket = expense.source === "forex" ? pocketOfForexSpend(usePocketsStore.getState().pockets, expense.id) : null;
    if (pocket) useForexSheetStore.getState().open(pocket.id);
    else onOpenExpense(expense);
  };

  return (
    <View>
      {showKeep && trip ? (
        <AuraCard style={styles.keep}>
          <Text style={[styles.keepTitle, { color: c.text, fontFamily: f.semibold }]}>{t("money.keepTitle")}</Text>
          <Text style={[styles.addPeopleText, { color: c.textSoft, fontFamily: f.regular }]}>{t("money.keepBody")}</Text>
          <View style={styles.keepActions}>
            <AuraButton label={t("money.keepAction")} icon="users" size="md" onPress={onKeepAsGroup} />
            <AuraButton label={t("money.notNow")} variant="ghost" size="md" onPress={() => useKeepGroupStore.getState().markHandled(trip.id)} />
          </View>
        </AuraCard>
      ) : null}

      {hasPeople && hasActivity ? (
        <View style={styles.block}>
          <GroupBalances group={group} recording={recording} onRecordingDone={onRecordingDone} />
        </View>
      ) : null}

      {hasActivity ? (
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
          {trip ? (
            <TripPaceCard trip={trip} items={mine} />
          ) : (
            <GroupPlaces items={conversion.convertedExpenses.map(({ expense, amount }) => ({ amount, date: expense.date, category: expense.category, merchant: expense.merchant }))} currency={group.currency} />
          )}
        </View>
      ) : null}

      {trip ? <TripForex trip={trip} /> : null}

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

      <RecurringList groupId={group.id} />

      {expenses.length === 0 && settlements.length === 0 ? (
        <AuraEmptyState
          icon="wallet"
          title={t("expenses.noExpensesTitle")}
          body={t("expenses.noExpensesBody")}
          action={<AuraButton label={t("expenses.importTitle")} icon="download" variant="secondary" size="md" onPress={onImport} />}
          style={styles.empty}
        />
      ) : (
        <>
          <AuraSection title={t("money.activity")} style={styles.section} />
          <GroupActivity
            expenses={expenses}
            settlements={settlements}
            convertedById={convertedById}
            displayCurrency={group.currency}
            showYourPart={hasPeople}
            onOpen={openExpense}
          />
        </>
      )}

      {!trip && group.companions.length > 0 ? (
        <AuraCard style={styles.addPeople}>
          <View style={styles.addPeopleRow}>
            <Icon name="compass" size={18} color={c.textSoft} />
            <Text style={[styles.addPeopleText, { color: c.textSoft, fontFamily: f.regular }]}>{t("money.planTripBody")}</Text>
          </View>
          <AuraButton label={t("money.planTrip")} icon="plus" variant="secondary" size="md" onPress={onPlanTrip} style={styles.addPeopleButton} />
        </AuraCard>
      ) : null}
      <ExportSheet visible={exportOpen} onClose={onCloseExport} expenses={expenses} title={group.name} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: 4 },
  keep: { marginBottom: 22, gap: 8 },
  keepTitle: { fontSize: 17 },
  keepActions: { flexDirection: "row", gap: 8, marginTop: 6 },
  spendAfterBalances: { marginTop: auraSpace.xxl },
  addPeople: { marginTop: auraSpace.xxl, gap: auraSpace.md },
  addPeopleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  addPeopleText: { flex: 1, fontSize: 14, lineHeight: 20 },
  addPeopleButton: { alignSelf: "flex-start" },
  section: { marginTop: 26 },
  empty: { marginTop: auraSpace.xxl },
});
