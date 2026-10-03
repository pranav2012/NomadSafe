import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAura } from "@/components/aura/useAura";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraCategoryColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { getCategoryMeta } from "@/features/expenses/constants/categories";
import type { Expense } from "@/features/expenses/store/expensesStore";

const SOURCE_KEYS: Partial<Record<Expense["source"], string>> = {
  sms: "expenses.sourceSms",
  paste: "expenses.sourcePasted",
  email: "expenses.sourceEmail",
  voice: "expenses.sourceVoice",
};

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Building an Intl formatter is slow, and the ledger renders one row per expense. */
function dayFormatter(locale: string) {
  let formatter = dayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
    dayFormatters.set(locale, formatter);
  }
  return formatter;
}

export function ExpenseRow({ expense, onPress }: { expense: Expense; onPress: () => void }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const meta = getCategoryMeta(expense.category);
  const tone = auraCategoryColors[expense.category];
  const sourceKey = SOURCE_KEYS[expense.source];
  const details = [
    dayFormatter(locale).format(new Date(expense.date)),
    sourceKey ? t(sourceKey) : null,
    expense.shares?.length ? t("split.badge", { count: expense.shares.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <PressableScale onPress={onPress} haptic={false} pressedScale={0.98} accessibilityRole="button" style={styles.row}>
      <View style={[styles.icon, { backgroundColor: `${tone}1F` }]}>
        <Icon name={meta.icon} size={18} color={tone} strokeWidth={1.8} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.merchant, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
          {expense.merchant}
        </Text>
        <View style={styles.metaRow}>
          <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
            {details}
          </Text>
          {expense.location?.label ? <Icon name="mapPin" size={11} color={c.textMuted} /> : null}
        </View>
      </View>
      <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>
        {formatCurrency(expense.amount, expense.currency, {})}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 11 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, gap: 3 },
  merchant: { fontSize: 15.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { fontSize: 12.5, flexShrink: 1 },
  amount: { fontSize: 15.5, fontVariant: ["tabular-nums"] },
});
