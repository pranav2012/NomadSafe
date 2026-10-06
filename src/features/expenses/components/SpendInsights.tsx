import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraCard, Icon, useAura, type IconName } from "@/atoms";
import { auraCategoryColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { formatMoney } from "@/features/expenses/utils/money";
import { inRange, periodRange, type SpendPeriod } from "@/features/expenses/utils/myMoney";
import { comparePeriods, monthlyByCategory, paceFor, topPlaces, type InsightItem } from "@/features/expenses/utils/spendInsights";
import { PlusChartTeaser, SpendBars } from "@/features/expenses/components/SpendCharts";
import { OWED, OWES } from "@/features/expenses/components/GroupBalances";

const MONTHS = 6;
const PLACES = 5;
const SAME = 0.03;

/** Plus insights on the Overview: vs the last period, pace, six months by category (tap to open one) and top places. */
export function SpendInsights({
  items,
  currency,
  period,
  offset,
  onPickMonth,
}: {
  items: InsightItem[];
  currency: string;
  period: SpendPeriod;
  offset: number;
  onPickMonth: (offset: number) => void;
}) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  if (!plus.isPlus) return <PlusChartTeaser text={t("money.insightsLocked")} />;

  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);
  const range = periodRange(period, offset);
  const current = items.filter((item) => inRange(item.date, range));
  const previous = items.filter((item) => inRange(item.date, periodRange(period, offset + 1)));
  const spent = current.reduce((sum, item) => sum + item.amount, 0);
  const { change, mover } = comparePeriods(current, previous);
  const pace = paceFor(period, offset, spent);
  const pct = (value: number) => Math.round(Math.abs(value) * 100);
  const categoryName = (category: string) => t(`expenses.category.${category}`);

  const lines: { text: string; icon: IconName; color?: string }[] = [];
  if (change !== null && current.length > 0) {
    const key = Math.abs(change) < SAME ? "same" : change > 0 ? "up" : "down";
    lines.push({
      text: t(`money.compare.${key}_${period}`, { pct: pct(change) }),
      color: key === "up" ? OWES : key === "down" ? OWED : undefined,
      icon: key === "up" ? "trendUp" : key === "down" ? "trendDown" : "minus",
    });
  }
  if (mover && Math.abs(mover.change) >= SAME) {
    lines.push({
      text: t(mover.change > 0 ? "money.compare.categoryUp" : "money.compare.categoryDown", { category: categoryName(mover.category), pct: pct(mover.change) }),
      icon: mover.change > 0 ? "trendUp" : "trendDown",
    });
  }
  if (pace !== null) lines.push({ text: t(`money.compare.pace_${period}`, { amount: money(pace) }), icon: "clock" });

  const months = monthlyByCategory(items, MONTHS);
  const monthName = (date: Date) => new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  const average = months.reduce((sum, month) => sum + month.total, 0) / MONTHS;
  const places = topPlaces(current, PLACES);

  return (
    <>
      {lines.length > 0 ? (
        <AuraCard style={styles.compare}>
          {lines.map((line) => (
            <View key={line.text} style={styles.line}>
              <Icon name={line.icon} size={16} color={line.color ?? c.textSoft} />
              <Text style={[styles.lineText, { color: line.color ?? c.text, fontFamily: f.regular }]}>{line.text}</Text>
            </View>
          ))}
        </AuraCard>
      ) : null}

      <SpendBars
        title={t("money.trendTitle")}
        aside={t("money.trendAverage", { amount: money(average) })}
        footer={[t("money.trendHint")]}
        bars={months.map((month) => {
          const selected = period === "month" ? month.offset === offset : month.offset === 0;
          return {
            key: month.start.toISOString(),
            label: monthName(month.start),
            total: month.total,
            highlight: selected,
            value: selected && month.total > 0 ? money(month.total) : undefined,
            segments: month.categories.map((entry) => ({ amount: entry.amount, color: auraCategoryColors[entry.category as keyof typeof auraCategoryColors] ?? c.textMuted })),
            onPress: () => onPickMonth(month.offset),
            accessibilityLabel: `${monthName(month.start)} ${money(month.total)}`,
          };
        })}
      />

      {places.length > 0 ? (
        <AuraCard style={styles.places}>
          <Text style={[styles.placesTitle, { color: c.text, fontFamily: f.semibold }]}>{t("money.topPlaces")}</Text>
          {places.map((place, index) => (
            <View key={place.name} style={[styles.place, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}>
              <View style={styles.flex}>
                <Text style={[styles.placeName, { color: c.text, fontFamily: f.regular }]} numberOfLines={1}>
                  {place.name}
                </Text>
                <Text style={[styles.placeMeta, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.placeCount", { count: place.count })}</Text>
              </View>
              <Text style={[styles.placeAmount, { color: c.text, fontFamily: f.medium }]}>{money(place.amount)}</Text>
            </View>
          ))}
        </AuraCard>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  compare: { marginTop: 18, gap: 10 },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  lineText: { flex: 1, fontSize: 14.5, lineHeight: 20 },
  places: { marginTop: 18, paddingVertical: 14 },
  placesTitle: { fontSize: 15, marginBottom: 4 },
  place: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  placeName: { fontSize: 14.5 },
  placeMeta: { fontSize: 12, marginTop: 2 },
  placeAmount: { fontSize: 14.5, fontVariant: ["tabular-nums"] },
});
