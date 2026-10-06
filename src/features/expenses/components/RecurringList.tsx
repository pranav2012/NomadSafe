import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraSection, Icon, PressableScale, showAlert, useAura } from "@/atoms";
import { useLocalization } from "@/localization";
import { usePlanStore } from "@/modules/billing";
import { useRecurringStore } from "@/features/expenses/store/recurringStore";
import { toLocalDayKey } from "@/features/expenses/utils/dateKey";
import { formatMoney } from "@/features/expenses/utils/money";
import { nextDueDay } from "@/features/expenses/utils/recurring";

/** Repeating spends of a trip or group (or of no group), with the next date and a way to stop each. */
export function RecurringList({ groupId }: { groupId: string | null }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const allRules = useRecurringStore((state) => state.rules);
  const rules = useMemo(() => allRules.filter((rule) => rule.groupId === groupId), [allRules, groupId]);
  const isPlus = usePlanStore((state) => state.unlimitedTrips);
  if (rules.length === 0) return null;
  const today = toLocalDayKey(new Date().toISOString());
  const dayLabel = (key: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(`${key}T12:00:00`));

  const stop = (id: string, merchant: string) =>
    showAlert(t("expenses.stopRepeatTitle", { merchant }), t("expenses.stopRepeatBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("expenses.stopRepeat"), style: "destructive", onPress: () => useRecurringStore.getState().remove(id) },
    ]);

  return (
    <View>
      <AuraSection title={t("expenses.repeating")} style={styles.section} />
      {!isPlus ? <Text style={[styles.paused, { color: c.textMuted, fontFamily: f.regular }]}>{t("expenses.repeatPaused")}</Text> : null}
      {rules.map((rule) => (
        <View key={rule.id} style={styles.row}>
          <View style={[styles.icon, { backgroundColor: c.surfaceStrong }]}>
            <Icon name="swap" size={16} color={c.textSoft} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
              {rule.template.merchant}
            </Text>
            <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
              {t(`expenses.repeatOption.${rule.frequency}`)} · {t("expenses.nextOn", { date: dayLabel(nextDueDay(rule.startDate, rule.frequency, today)) })}
            </Text>
          </View>
          <Text style={[styles.amount, { color: c.text, fontFamily: f.semibold }]}>{formatMoney(formatCurrency, rule.template.amount, rule.template.currency)}</Text>
          <PressableScale onPress={() => stop(rule.id, rule.template.merchant)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("expenses.stopRepeat")}>
            <Icon name="x" size={16} color={c.textMuted} />
          </PressableScale>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 26 },
  paused: { fontSize: 13, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  icon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  name: { fontSize: 15 },
  meta: { fontSize: 12.5, marginTop: 2 },
  amount: { fontSize: 15, fontVariant: ["tabular-nums"] },
});
