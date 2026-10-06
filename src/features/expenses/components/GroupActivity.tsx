import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { useExpensesStore, type Expense, type Settlement } from "@/features/expenses/store/expensesStore";
import { ExpenseRow } from "@/features/expenses/components/ExpenseRow";
import { personLabel } from "@/features/expenses/components/SplitEditor";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney } from "@/features/expenses/utils/money";
import { SELF_ID } from "@/features/expenses/utils/split";

const PAGE = 40;

type Item = { kind: "expense"; at: string; expense: Expense } | { kind: "settlement"; at: string; settlement: Settlement };

/** Expenses and payments of one trip, group or "not in a group", newest first and grouped by day. */
export function GroupActivity({
  expenses,
  settlements = [],
  convertedById,
  displayCurrency,
  showYourPart,
  onOpen,
}: {
  expenses: Expense[];
  settlements?: Settlement[];
  convertedById?: Map<string, number>;
  displayCurrency?: string;
  showYourPart: boolean;
  onOpen: (expense: Expense) => void;
}) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const deleteSettlement = useExpensesStore((state) => state.deleteSettlement);
  const [limit, setLimit] = useState(PAGE);
  const [now] = useState(() => Date.now());

  const days = useMemo(() => {
    const items: Item[] = [
      ...expenses.map((expense) => ({ kind: "expense" as const, at: expense.date, expense })),
      ...settlements.map((settlement) => ({ kind: "settlement" as const, at: settlement.date, settlement })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const shown = items.slice(0, limit);
    const grouped: { key: string; items: Item[] }[] = [];
    for (const item of shown) {
      const key = toLocalDayKey(item.at);
      const last = grouped[grouped.length - 1];
      if (last?.key === key) last.items.push(item);
      else grouped.push({ key, items: [item] });
    }
    return { grouped, total: items.length };
  }, [expenses, settlements, limit]);

  const dayLabel = (key: string) => {
    const date = new Date(`${key}T12:00:00`);
    const today = toLocalDayKey(new Date(now).toISOString());
    const yesterday = toLocalDayKey(new Date(now - 86_400_000).toISOString());
    if (key === today) return t("money.today");
    if (key === yesterday) return t("money.yesterday");
    return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(date);
  };

  const confirmDelete = (id: string) =>
    showAlert(t("split.deletePaymentTitle"), t("split.deletePaymentBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => deleteSettlement(id) },
    ]);

  if (days.total === 0) return null;

  return (
    <View>
      {days.grouped.map((day) => (
        <View key={day.key} style={styles.day}>
          <Text style={[styles.dayLabel, { color: c.textMuted, fontFamily: f.medium }]}>{dayLabel(day.key)}</Text>
          {day.items.map((item) =>
            item.kind === "expense" ? (
              <ExpenseRow
                key={item.expense.id}
                expense={item.expense}
                convertedAmount={convertedById?.get(item.expense.id)}
                displayCurrency={displayCurrency}
                showYourPart={showYourPart}
                hideDate
                onPress={() => onOpen(item.expense)}
              />
            ) : (
              <PressableScale
                key={item.settlement.id}
                haptic={false}
                pressedScale={0.98}
                onLongPress={() => confirmDelete(item.settlement.id)}
                accessibilityHint={t("money.longPressDelete")}
                style={styles.payment}
              >
                <View style={[styles.icon, { backgroundColor: c.surfaceStrong }]}>
                  <Icon name="swap" size={17} color={c.textSoft} />
                </View>
                <Text style={[styles.paymentWho, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                  {item.settlement.to === SELF_ID
                    ? t("split.paidYou", { from: personLabel(item.settlement.from, t) })
                    : item.settlement.from === SELF_ID
                      ? t("split.youPaid", { to: personLabel(item.settlement.to, t) })
                      : t("split.paid", { from: personLabel(item.settlement.from, t), to: personLabel(item.settlement.to, t) })}
                </Text>
                <Text style={[styles.paymentAmount, { color: c.textSoft, fontFamily: f.semibold }]}>
                  {formatMoney(formatCurrency, item.settlement.amount, item.settlement.currency)}
                </Text>
              </PressableScale>
            ),
          )}
        </View>
      ))}
      {days.total > limit ? (
        <AuraButton label={t("expenses.seeAll", { count: days.total })} variant="secondary" size="md" onPress={() => setLimit(days.total)} style={styles.more} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  day: { marginTop: 14 },
  dayLabel: { fontSize: 12.5, letterSpacing: 0.2, textTransform: "uppercase", marginBottom: 2 },
  payment: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 11 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  paymentWho: { flex: 1, fontSize: 15 },
  paymentAmount: { fontSize: 15, fontVariant: ["tabular-nums"] },
  more: { alignSelf: "center", marginTop: 12 },
});
