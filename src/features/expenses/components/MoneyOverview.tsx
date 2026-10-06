import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraOptionSheet, AuraSection, Icon, PressableScale, useAura, type AuraOption } from "@/atoms";
import { useLocalization } from "@/localization";
import { isArchivedGroup, isTrip, selectMoneyGroups, useTripsStore, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { useGroupBalances } from "@/features/expenses/hooks/useGroupBalances";
import { useOverallBalance, type GroupBalanceRow } from "@/features/expenses/hooks/useOverallBalance";
import { categoryBreakdown, sumAmount } from "@/features/expenses/utils/aggregate";
import { formatMoney } from "@/features/expenses/utils/money";
import { inRange, myShareOf, periodRange } from "@/features/expenses/utils/myMoney";
import { GroupActivity } from "@/features/expenses/components/GroupActivity";
import { RecurringList } from "@/features/expenses/components/RecurringList";
import { OWED, OWES } from "@/features/expenses/components/GroupBalances";
import { SpendHero } from "@/features/expenses/components/SpendHero";
import { BiggestSpends, MonthInsights, OverviewTrend } from "@/features/expenses/components/SpendInsights";
import { periodTotals } from "@/features/expenses/utils/spendInsights";
import { usePlusGate } from "@/modules/billing";
import { ExportSheet } from "@/features/expenses/components/ExportSheet";

const SETTLED_AFTER_MS = 30 * 86_400_000;
const MAX_MONTHS_BACK = 24;

/** Money with no trip open: your spending everywhere, your overall balance, trips and groups, and spends in no group. */
export function MoneyOverview({
  onOpenGroup,
  onOpenExpense,
  onNewGroup,
  exportOpen,
  onCloseExport,
}: {
  onOpenGroup: (id: string) => void;
  onOpenExpense: (expense: Expense) => void;
  onNewGroup: () => void;
  exportOpen: boolean;
  onCloseExport: () => void;
}) {
  const { c, f } = useAura();
  const { t, locale, currency: homeCurrency, formatCurrency } = useLocalization();
  const groups = useTripsStore(selectMoneyGroups);
  const expenses = useExpensesStore((state) => state.expenses);
  const [offset, setOffset] = useState(0);
  const [monthsOpen, setMonthsOpen] = useState(false);
  const plus = usePlusGate();
  const [showSettled, setShowSettled] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const archivedGroups = groups.filter(isArchivedGroup);
  const [now] = useState(() => Date.now());
  const money = (amount: number) => formatMoney(formatCurrency, amount, homeCurrency);

  const range = periodRange("month", offset);
  const inPeriod = useMemo(
    () => expenses.filter((expense) => inRange(expense.date, range)).map((expense) => ({ ...expense, amount: myShareOf(expense) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, offset],
  );
  const spendConversion = useConvertedExpenses(inPeriod, homeCurrency);
  const periodExpenses = useMemo(
    () => expenses.filter((expense) => inRange(expense.date, range)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, offset],
  );
  const mine: Expense[] = spendConversion.convertedExpenses.map(({ expense, amount }) => ({ ...expense, amount, currency: homeCurrency }));
  const spent = sumAmount(mine);
  const allMine = useMemo(() => expenses.map((expense) => ({ ...expense, amount: myShareOf(expense) })), [expenses]);
  const insightConversion = useConvertedExpenses(allMine, homeCurrency);
  const insightItems = insightConversion.convertedExpenses.map(({ expense, amount }) => ({ id: expense.id, amount, date: expense.date, category: expense.category, merchant: expense.merchant }));

  const { rows, overall, ready: overallReady } = useOverallBalance();
  const isSettled = (row: GroupBalanceRow) => row.unconverted === 0 && Math.abs(row.net) < 0.005 && now - row.lastActivity > SETTLED_AFTER_MS;
  const active = rows.filter((row) => !isSettled(row));
  const settled = rows.filter(isSettled);
  const loose = useMemo(() => expenses.filter((expense) => expense.groupId === null), [expenses]);

  const monthLabel = (offsetBack: number) => {
    const start = periodRange("month", offsetBack).start;
    return new Intl.DateTimeFormat(locale, { month: "long", year: start.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(start);
  };
  const periodLabel = monthLabel(offset);
  const firstDate = expenses.reduce((min, expense) => Math.min(min, new Date(expense.date).getTime()), Date.now());
  const monthsBack = Math.min(MAX_MONTHS_BACK, Math.max(0, (new Date().getFullYear() - new Date(firstDate).getFullYear()) * 12 + new Date().getMonth() - new Date(firstDate).getMonth()));
  const monthTotals = periodTotals(insightItems, "month", monthsBack + 1);
  const monthOptions: AuraOption<number>[] = monthTotals
    .map((month) => ({ value: month.offset, label: monthLabel(month.offset), detail: month.total > 0 ? money(month.total) : undefined }))
    .reverse();
  const unconvertedLabel = spendConversion.unconvertedTotals.map((entry) => formatMoney(formatCurrency, entry.amount, entry.currency)).join(" + ");

  const row = ({ group }: GroupBalanceRow) => <GroupListRow key={group.id} group={group} onPress={() => onOpenGroup(group.id)} />;

  return (
    <View>
      <PressableScale
        onPress={() => setMonthsOpen(true)}
        disabled={monthsBack === 0}
        haptic={false}
        accessibilityRole="button"
        accessibilityHint={t("money.chooseMonth")}
        style={styles.monthPicker}
      >
        <Text style={[styles.monthLabel, { color: c.text, fontFamily: f.semibold }]}>{periodLabel}</Text>
        {monthsBack > 0 ? <Icon name="chevronDown" size={16} color={c.textSoft} /> : null}
      </PressableScale>
      <AuraOptionSheet visible={monthsOpen} onClose={() => setMonthsOpen(false)} title={t("money.chooseMonth")} options={monthOptions} selected={offset} onSelect={setOffset} />

      <SpendHero
        label={t("money.yourSpending")}
        currency={homeCurrency}
        total={spent}
        daysLeft={0}
        breakdown={plus.isPlus ? [] : categoryBreakdown(mine)}
        caption={t("money.everywhereCaption")}
        note={
          unconvertedLabel
            ? spendConversion.isConverting
              ? t("expenses.convertingAmounts", { amount: unconvertedLabel })
              : t("expenses.notConverted", { amount: unconvertedLabel })
            : null
        }
      >
        <OverviewTrend items={insightItems} offset={offset} />
      </SpendHero>

      <MonthInsights items={insightItems} currency={homeCurrency} offset={offset} />
      <BiggestSpends
        items={insightItems}
        currency={homeCurrency}
        offset={offset}
        onOpen={(id) => {
          const expense = expenses.find((entry) => entry.id === id);
          if (expense) onOpenExpense(expense);
        }}
      />

      <AuraSection
        title={t("money.groupsAndTrips")}
        action={
          <PressableScale onPress={onNewGroup} hitSlop={8} accessibilityRole="button" style={styles.newGroup}>
            <Icon name="plus" size={14} color={c.text} />
            <Text style={[styles.newGroupText, { color: c.text, fontFamily: f.semibold }]}>{t("money.newGroup")}</Text>
          </PressableScale>
        }
        style={styles.section}
      />
      {rows.length > 0 && overallReady ? (
        <Text style={[styles.overall, { color: overall > 0 ? OWED : overall < 0 ? OWES : c.textSoft, fontFamily: f.semibold }]}>
          {overall > 0 ? t("money.overallOwed", { amount: money(overall) }) : overall < 0 ? t("money.overallOwe", { amount: money(-overall) }) : t("split.settled")}
        </Text>
      ) : rows.length > 0 ? null : (
        <AuraCard style={styles.emptyGroups}>
          <Text style={[styles.emptyBody, { color: c.textSoft, fontFamily: f.regular }]}>{t("money.noGroupsBody")}</Text>
          <AuraButton label={t("money.newGroup")} icon="plus" variant="secondary" size="md" onPress={onNewGroup} style={styles.emptyButton} />
        </AuraCard>
      )}
      {active.map(row)}
      {settled.length > 0 ? (
        <>
          <PressableScale haptic={false} onPress={() => setShowSettled(!showSettled)} accessibilityRole="button" style={styles.settledToggle}>
            <Text style={[styles.settledLabel, { color: c.textMuted, fontFamily: f.medium }]}>{t("money.settledSection", { count: settled.length })}</Text>
            <Icon name={showSettled ? "chevronDown" : "chevronRight"} size={14} color={c.textMuted} />
          </PressableScale>
          {showSettled ? settled.map(row) : null}
        </>
      ) : null}

      {archivedGroups.length > 0 ? (
        <>
          <PressableScale haptic={false} onPress={() => setShowArchived(!showArchived)} accessibilityRole="button" style={styles.settledToggle}>
            <Text style={[styles.settledLabel, { color: c.textMuted, fontFamily: f.medium }]}>{t("groupSettings.archivedSection", { count: archivedGroups.length })}</Text>
            <Icon name={showArchived ? "chevronDown" : "chevronRight"} size={14} color={c.textMuted} />
          </PressableScale>
          {showArchived ? archivedGroups.map((group) => <GroupListRow key={group.id} group={group} onPress={() => onOpenGroup(group.id)} />) : null}
        </>
      ) : null}

      <RecurringList groupId={null} />

      {loose.length > 0 ? (
        <>
          <AuraSection title={t("money.yourSpends")} style={styles.section} />
          <GroupActivity expenses={loose} showYourPart={false} onOpen={onOpenExpense} />
        </>
      ) : null}
      <ExportSheet visible={exportOpen} onClose={onCloseExport} expenses={periodExpenses} title={`${t("money.yourSpending")} · ${periodLabel}`} />
    </View>
  );
}

/** One trip or group with your balance in its own currency (exact, no conversion needed). */
function GroupListRow({ group, onPress }: { group: MoneyGroup; onPress: () => void }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const { myNet, splitExpenses, settlements } = useGroupBalances(group);
  const money = (amount: number) => formatMoney(formatCurrency, amount, group.currency);
  const splits = splitExpenses.length > 0 || settlements.length > 0;
  return (
    <PressableScale haptic={false} pressedScale={0.98} onPress={onPress} accessibilityRole="button" style={styles.groupRow}>
      <View style={[styles.groupIcon, { backgroundColor: c.surfaceStrong }]}>
        {isTrip(group) ? <Icon name="compass" size={18} color={c.textSoft} /> : <Text style={styles.emoji}>{group.emoji || "👥"}</Text>}
      </View>
      <View style={styles.flex}>
        <Text style={[styles.groupName, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
          {group.name}
        </Text>
        <Text style={[styles.groupMeta, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
          {[isTrip(group) ? t("money.tripBadge") : null, t("money.people", { count: group.companions.length + 1 })].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {splits || group.companions.length > 0 ? (
        <Text style={[styles.groupNet, { color: myNet > 0 ? OWED : myNet < 0 ? OWES : c.textMuted, fontFamily: f.medium }]}>
          {myNet > 0 ? t("money.owedShort", { amount: money(myNet) }) : myNet < 0 ? t("money.oweShort", { amount: money(-myNet) }) : t("split.settledWith")}
        </Text>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  monthPicker: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 2 },
  monthLabel: { fontSize: 17 },
  flex: { flex: 1 },
  section: { marginTop: 28 },
  newGroup: { flexDirection: "row", alignItems: "center", gap: 4 },
  newGroupText: { fontSize: 13.5 },
  overall: { fontSize: 20, letterSpacing: -0.4, marginBottom: 6 },
  groupRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 11 },
  groupIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 20 },
  groupName: { fontSize: 15.5 },
  groupMeta: { fontSize: 12.5, marginTop: 2 },
  groupNet: { fontSize: 13.5, fontVariant: ["tabular-nums"] },
  settledToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12 },
  settledLabel: { fontSize: 13.5 },
  emptyGroups: { gap: 10 },
  emptyBody: { fontSize: 14.5, lineHeight: 21 },
  emptyButton: { alignSelf: "flex-start" },
});
