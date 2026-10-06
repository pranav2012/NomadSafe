import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraCard, Icon, PressableScale, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { formatMoney } from "@/features/expenses/utils/money";
import { monthlyTotals } from "@/features/expenses/utils/myMoney";

const MONTHS = 6;
const BAR_HEIGHT = 96;

/** Your spending per month for the last six months (Plus); free users see a locked card that opens the paywall. */
export function SpendTrend({ items, currency }: { items: { amount: number; date: string }[]; currency: string }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const plus = usePlusGate();

  if (!plus.isPlus) {
    return (
      <PressableScale onPress={() => plus.run("charts", () => undefined)} pressedScale={0.98} accessibilityRole="button" style={styles.lockedWrap}>
        <AuraCard style={styles.locked}>
          <Icon name="lock" size={16} color={c.textSoft} />
          <Text style={[styles.lockedText, { color: c.textSoft, fontFamily: f.regular }]}>{t("money.trendLocked")}</Text>
          <Icon name="chevronRight" size={14} color={c.textMuted} />
        </AuraCard>
      </PressableScale>
    );
  }

  const months = monthlyTotals(items, MONTHS);
  const max = Math.max(...months.map((month) => month.total), 1);
  const average = months.reduce((sum, month) => sum + month.total, 0) / MONTHS;
  const monthName = (date: Date) => new Intl.DateTimeFormat(locale, { month: "short" }).format(date);

  return (
    <AuraCard style={styles.card}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("money.trendTitle")}</Text>
        <Text style={[styles.average, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.trendAverage", { amount: formatMoney(formatCurrency, average, currency) })}</Text>
      </View>
      <View style={styles.bars} accessibilityRole="image" accessibilityLabel={months.map((month) => `${monthName(month.start)} ${formatMoney(formatCurrency, month.total, currency)}`).join(", ")}>
        {months.map((month, index) => {
          const current = index === months.length - 1;
          return (
            <View key={month.start.toISOString()} style={styles.column}>
              {current ? (
                <Text style={[styles.value, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                  {formatMoney(formatCurrency, month.total, currency)}
                </Text>
              ) : null}
              <View style={[styles.track, { height: BAR_HEIGHT }]}>
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(3, (month.total / max) * BAR_HEIGHT), backgroundColor: current ? auraStatusAccent.calm : c.surfaceStrong },
                  ]}
                />
              </View>
              <Text style={[styles.month, { color: current ? c.text : c.textMuted, fontFamily: f.regular }]}>{monthName(month.start)}</Text>
            </View>
          );
        })}
      </View>
    </AuraCard>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 18, gap: 14 },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15 },
  average: { fontSize: 12.5 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  column: { flex: 1, alignItems: "center", gap: 6 },
  value: { fontSize: 11.5 },
  track: { width: "100%", justifyContent: "flex-end" },
  bar: { width: "100%", borderRadius: 6 },
  month: { fontSize: 12 },
  lockedWrap: { marginTop: 18 },
  locked: { flexDirection: "row", alignItems: "center", gap: 10 },
  lockedText: { flex: 1, fontSize: 14 },
});
