import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, AuraCard, AuraSection, AuraSegmented, Icon, PressableScale, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { isTrip, selectMoneyGroups, useTripsStore, type MoneyGroup } from "@/features/trips/store/tripsStore";
import { useExpensesStore, type Expense } from "@/features/expenses/store/expensesStore";
import { useConvertedExpenses } from "@/features/expenses/hooks/useTripExpenseSummary";
import { useGroupBalances } from "@/features/expenses/hooks/useGroupBalances";
import { useOverallBalance, type GroupBalanceRow } from "@/features/expenses/hooks/useOverallBalance";
import { categoryBreakdown, sumAmount } from "@/features/expenses/utils/aggregate";
import { formatMoney } from "@/features/expenses/utils/money";
import { inRange, myShareOf, periodRange, type SpendPeriod } from "@/features/expenses/utils/myMoney";
import { GroupActivity } from "@/features/expenses/components/GroupActivity";
import { RecurringList } from "@/features/expenses/components/RecurringList";
import { OWED, OWES } from "@/features/expenses/components/GroupBalances";
import { SpendHero } from "@/features/expenses/components/SpendHero";

const SETTLED_AFTER_MS = 30 * 86_400_000;

/** Money with no trip open: your spending everywhere, your overall balance, trips and groups, and spends in no group. */
export function MoneyOverview({
  onOpenGroup,
  onOpenExpense,
  onNewGroup,
}: {
  onOpenGroup: (id: string) => void;
  onOpenExpense: (expense: Expense) => void;
  onNewGroup: () => void;
}) {
  const { c, f } = useAura();
  const { t, locale, currency: homeCurrency, formatCurrency } = useLocalization();
  const groups = useTripsStore(selectMoneyGroups);
  const expenses = useExpensesStore((state) => state.expenses);
  const [period, setPeriod] = useState<SpendPeriod>("month");
  const [offset, setOffset] = useState(0);
  const [showSettled, setShowSettled] = useState(false);
  const [now] = useState(() => Date.now());
  const money = (amount: number) => formatMoney(formatCurrency, amount, homeCurrency);

  const range = periodRange(period, offset);
  const inPeriod = useMemo(
    () => expenses.filter((expense) => inRange(expense.date, range)).map((expense) => ({ ...expense, amount: myShareOf(expense) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, period, offset],
  );
  const spendConversion = useConvertedExpenses(inPeriod, homeCurrency);
  const mine: Expense[] = spendConversion.convertedExpenses.map(({ expense, amount }) => ({ ...expense, amount, currency: homeCurrency }));
  const spent = sumAmount(mine);

  const nameOf = (groupId: string | null) => groups.find((group) => group.id === groupId)?.name ?? t("money.notInGroup");
  const bySource = new Map<string, { label: string; amount: number; groupId: string | null }>();
  for (const expense of mine) {
    const key = expense.groupId ?? "none";
    const entry = bySource.get(key) ?? { label: nameOf(expense.groupId), amount: 0, groupId: expense.groupId };
    entry.amount += expense.amount;
    bySource.set(key, entry);
  }
  const sources = [...bySource.values()].filter((entry) => entry.amount > 0.004).sort((a, b) => b.amount - a.amount);

  const { rows, overall, ready: overallReady } = useOverallBalance();
  const isSettled = (row: GroupBalanceRow) => row.unconverted === 0 && Math.abs(row.net) < 0.005 && now - row.lastActivity > SETTLED_AFTER_MS;
  const active = rows.filter((row) => !isSettled(row));
  const settled = rows.filter(isSettled);
  const loose = useMemo(() => expenses.filter((expense) => expense.groupId === null), [expenses]);

  const periodLabel =
    period === "month"
      ? new Intl.DateTimeFormat(locale, { month: "long", year: range.start.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(range.start)
      : offset === 0
        ? t("money.thisWeek")
        : `${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(range.start)} – ${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(range.end.getTime() - 1))}`;
  const unconvertedLabel = spendConversion.unconvertedTotals.map((entry) => formatMoney(formatCurrency, entry.amount, entry.currency)).join(" + ");

  const row = ({ group }: GroupBalanceRow) => <GroupListRow key={group.id} group={group} onPress={() => onOpenGroup(group.id)} />;

  return (
    <View>
      <AuraSegmented
        options={[
          { value: "week", label: t("money.week") },
          { value: "month", label: t("money.month") },
        ]}
        value={period}
        onChange={(next) => {
          setPeriod(next);
          setOffset(0);
        }}
      />
      <View style={styles.periodRow}>
        <PressableScale onPress={() => setOffset(offset + 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("money.previousPeriod")} style={[styles.arrow, { backgroundColor: c.surfaceStrong }]}>
          <Icon name="chevronLeft" size={16} color={c.text} />
        </PressableScale>
        <Text style={[styles.periodLabel, { color: c.text, fontFamily: f.medium }]}>{periodLabel}</Text>
        <PressableScale
          onPress={() => setOffset(Math.max(0, offset - 1))}
          disabled={offset === 0}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("money.nextPeriod")}
          style={[styles.arrow, { backgroundColor: c.surfaceStrong, opacity: offset === 0 ? 0.35 : 1 }]}
        >
          <Icon name="chevronRight" size={16} color={c.text} />
        </PressableScale>
      </View>

      <SpendHero
        label={t("money.yourSpending")}
        currency={homeCurrency}
        total={spent}
        daysLeft={0}
        breakdown={categoryBreakdown(mine)}
        caption={t("money.everywhereCaption")}
        note={
          unconvertedLabel
            ? spendConversion.isConverting
              ? t("expenses.convertingAmounts", { amount: unconvertedLabel })
              : t("expenses.notConverted", { amount: unconvertedLabel })
            : null
        }
      />

      {sources.length > 0 ? (
        <AuraCard style={styles.sources}>
          {sources.map((source, index) => (
            <PressableScale
              key={source.groupId ?? "none"}
              haptic={false}
              disabled={!source.groupId}
              onPress={() => source.groupId && onOpenGroup(source.groupId)}
              style={[styles.source, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}
            >
              <Text style={[styles.sourceName, { color: c.text, fontFamily: f.regular }]} numberOfLines={1}>
                {source.label}
              </Text>
              <Text style={[styles.sourceAmount, { color: c.text, fontFamily: f.medium }]}>{money(source.amount)}</Text>
              {source.groupId ? <Icon name="chevronRight" size={14} color={c.textMuted} /> : <View style={styles.chevronSpace} />}
            </PressableScale>
          ))}
        </AuraCard>
      ) : null}

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

      <RecurringList groupId={null} />

      {loose.length > 0 ? (
        <>
          <AuraSection title={t("money.yourSpends")} style={styles.section} />
          <GroupActivity expenses={loose} showYourPart={false} onOpen={onOpenExpense} />
        </>
      ) : null}
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
  flex: { flex: 1 },
  periodRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14, marginBottom: 4 },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  periodLabel: { fontSize: 15 },
  sources: { marginTop: 18, paddingVertical: 4 },
  source: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  sourceName: { flex: 1, fontSize: 14.5 },
  sourceAmount: { fontSize: 14.5, fontVariant: ["tabular-nums"] },
  chevronSpace: { width: 14 },
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
