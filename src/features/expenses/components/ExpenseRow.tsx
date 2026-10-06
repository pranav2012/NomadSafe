import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, PressableScale, useAura } from "@/atoms";
import { auraCategoryColors, auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { getCategoryMeta } from "@/features/expenses/constants/categories";
import type { Expense } from "@/features/expenses/store/expensesStore";
import { personLabel } from "@/features/expenses/components/SplitEditor";
import { myLentOf } from "@/features/expenses/utils/myMoney";
import { payersOf } from "@/features/expenses/utils/split";

const OWED_COLOR = "#3DDC97";

const SOURCE_KEYS: Partial<Record<Expense["source"], string>> = {
  sms: "expenses.sourceSms",
  paste: "expenses.sourcePasted",
  email: "expenses.sourceEmail",
  voice: "expenses.sourceVoice",
  recurring: "expenses.sourceRecurring",
  import: "expenses.sourceImport",
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

/**
 * One ledger row. With `displayCurrency` and a converted amount, a foreign spend shows in the trip
 * currency (at that day's rate) with its original amount underneath.
 */
export function ExpenseRow({
  expense,
  convertedAmount,
  displayCurrency,
  onPress,
  showYourPart = false,
  hideDate = false,
}: {
  expense: Expense;
  convertedAmount?: number;
  displayCurrency?: string;
  onPress: () => void;
  /** In a trip or group with people: who paid, what you lent or borrowed, and "Only you" for unsplit spends. */
  showYourPart?: boolean;
  /** Under a day heading the date is already shown. */
  hideDate?: boolean;
}) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const meta = getCategoryMeta(expense.category);
  const tone = auraCategoryColors[expense.category];
  const sourceKey = SOURCE_KEYS[expense.source];
  const payers = payersOf(expense);
  const lent = showYourPart ? myLentOf(expense) : null;
  const details = [
    hideDate ? null : dayFormatter(locale).format(new Date(expense.date)),
    showYourPart && expense.shares?.length
      ? payers.length > 1
        ? t("money.severalPaid", { count: payers.length })
        : t("money.whoPaid", { name: personLabel(payers[0].person, t) })
      : null,
    sourceKey ? t(sourceKey) : null,
    expense.shares?.length ? t("split.badge", { count: expense.shares.length }) : null,
    showYourPart && !expense.shares?.length ? t("money.onlyYou") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const yourPart =
    lent === null || Math.abs(lent) < 0.005
      ? null
      : { text: lent > 0 ? t("money.youLent", { amount: formatCurrency(lent, expense.currency, {}) }) : t("money.youBorrowed", { amount: formatCurrency(-lent, expense.currency, {}) }), color: lent > 0 ? OWED_COLOR : auraStatusAccent.alert };

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
        {expense.splitHint ? (
          <View style={[styles.hint, { backgroundColor: `${auraStatusAccent.live}22` }]}>
            <Icon name="users" size={11} color={auraStatusAccent.live} />
            <Text style={[styles.hintText, { color: auraStatusAccent.live, fontFamily: f.medium }]}>
              {expense.splitHint.shares ? t("split.reviewBadge") : t("split.suggestFor", { count: expense.splitHint.pax })}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.amounts}>
        {displayCurrency && expense.currency !== displayCurrency && convertedAmount !== undefined ? (
          <>
            <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>
              {formatCurrency(convertedAmount, displayCurrency, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </Text>
            <Text style={[styles.original, { color: c.textMuted, fontFamily: f.regular }]}>{formatCurrency(expense.amount, expense.currency, {})}</Text>
          </>
        ) : (
          <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>{formatCurrency(expense.amount, expense.currency, {})}</Text>
        )}
        {yourPart ? <Text style={[styles.original, { color: yourPart.color, fontFamily: f.medium }]}>{yourPart.text}</Text> : null}
      </View>
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
  amounts: { alignItems: "flex-end", gap: 2 },
  hint: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingHorizontal: 7, height: 20, borderRadius: 10, marginTop: 2 },
  hintText: { fontSize: 11.5 },
  original: { fontSize: 12, fontVariant: ["tabular-nums"] },
});
