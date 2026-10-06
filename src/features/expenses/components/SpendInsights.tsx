import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Circle, Path, Skia } from "react-native-skia";
import { AuraCard, Icon, PressableScale, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { formatMoney } from "@/features/expenses/utils/money";
import { inRange, periodRange, type SpendPeriod } from "@/features/expenses/utils/myMoney";
import { comparePeriods, periodTotals, topPlaces, type InsightItem } from "@/features/expenses/utils/spendInsights";
import { OWED, OWES } from "@/features/expenses/components/GroupBalances";

const SPARK_HEIGHT = 44;
const DOT = 3.5;
const PLACES = 5;
const SAME = 0.03;

/** Under the Overview total (Plus): a sparkline of recent weeks or months ending at the chosen one, and how it compares with the one before. */
export function OverviewTrend({ items, currency, period, offset }: { items: InsightItem[]; currency: string; period: SpendPeriod; offset: number }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const plus = usePlusGate();

  if (!plus.isPlus) {
    return (
      <PressableScale onPress={() => plus.run("charts", () => undefined)} haptic={false} accessibilityRole="button" style={styles.locked}>
        <Icon name="lock" size={13} color={c.textMuted} />
        <Text style={[styles.lockedText, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.insightsLocked")}</Text>
      </PressableScale>
    );
  }

  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);
  const points = periodTotals(items, period, period === "month" ? 6 : 8, offset);
  const current = items.filter((item) => inRange(item.date, periodRange(period, offset)));
  const previous = items.filter((item) => inRange(item.date, periodRange(period, offset + 1)));
  const { change, mover } = comparePeriods(current, previous);
  const pct = (value: number) => Math.round(Math.abs(value) * 100);
  const label = (date: Date) =>
    new Intl.DateTimeFormat(locale, period === "month" ? { month: "short" } : { month: "short", day: "numeric" }).format(date);

  const direction = change === null ? null : Math.abs(change) < SAME ? "same" : change > 0 ? "up" : "down";
  const parts = [
    direction && change !== null ? t(`money.compare.${direction}_${period}`, { pct: pct(change) }) : null,
    mover && Math.abs(mover.change) >= SAME
      ? t(mover.change > 0 ? "money.compare.categoryUp" : "money.compare.categoryDown", { category: t(`expenses.category.${mover.category}`), pct: pct(mover.change) })
      : null,
  ].filter((part): part is string => !!part);

  return (
    <View style={styles.trend}>
      {points.some((point) => point.total > 0) ? (
        <>
          <Sparkline values={points.map((point) => point.total)} color={auraStatusAccent.calm} accessibilityLabel={points.map((point) => `${label(point.start)} ${money(point.total)}`).join(", ")} />
          <View style={styles.ends}>
            <Text style={[styles.end, { color: c.textMuted, fontFamily: f.regular }]}>{label(points[0].start)}</Text>
            <Text style={[styles.end, { color: c.textMuted, fontFamily: f.regular }]}>{label(points[points.length - 1].start)}</Text>
          </View>
        </>
      ) : null}
      {parts.length > 0 ? (
        <View style={styles.compare}>
          {direction === "up" || direction === "down" ? (
            <Icon name={direction === "up" ? "trendUp" : "trendDown"} size={15} color={direction === "up" ? OWES : OWED} />
          ) : null}
          <Text style={[styles.compareText, { color: c.textSoft, fontFamily: f.regular }]}>{parts.join(" · ")}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A thin line through the values with a soft fill and a dot on the last one. */
function Sparkline({ values, color, accessibilityLabel }: { values: number[]; color: string; accessibilityLabel: string }) {
  const [width, setWidth] = useState(0);
  const max = Math.max(...values, 1);
  const inset = DOT + 1;
  const xAt = (index: number) => inset + (index / Math.max(1, values.length - 1)) * (width - inset * 2);
  const yAt = (value: number) => inset + (1 - value / max) * (SPARK_HEIGHT - inset * 2);

  const points = values.map((value, index) => ({ x: xAt(index), y: yAt(value) }));
  // Catmull-Rom through the points as cubic Béziers, with control points kept between neighbours so flat stretches never dip.
  const builder = Skia.PathBuilder.Make();
  points.forEach((point, index) => {
    if (index === 0) return builder.moveTo(point.x, point.y);
    const p0 = points[index - 2] ?? points[index - 1];
    const p1 = points[index - 1];
    const p3 = points[index + 1] ?? point;
    const low = Math.min(p1.y, point.y);
    const high = Math.max(p1.y, point.y);
    const clamp = (y: number) => Math.min(high, Math.max(low, y));
    builder.cubicTo(p1.x + (point.x - p0.x) / 6, clamp(p1.y + (point.y - p0.y) / 6), point.x - (p3.x - p1.x) / 6, clamp(point.y - (p3.y - p1.y) / 6), point.x, point.y);
  });
  const line = builder.build();
  builder.lineTo(points[points.length - 1].x, SPARK_HEIGHT).lineTo(points[0].x, SPARK_HEIGHT).close();
  const fill = builder.detach();
  const last = values.length - 1;

  return (
    <View style={styles.spark} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} accessible accessibilityLabel={accessibilityLabel}>
      {width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Path path={fill} color={`${color}30`} />
          <Path path={line} color={color} style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />
          <Circle cx={xAt(last)} cy={yAt(values[last])} r={DOT} color={color} />
        </Canvas>
      ) : null}
    </View>
  );
}

/** The places you spent most at in the chosen period (Plus). */
export function TopPlaces({ items, currency, period, offset }: { items: InsightItem[]; currency: string; period: SpendPeriod; offset: number }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  if (!plus.isPlus) return null;
  const places = topPlaces(
    items.filter((item) => inRange(item.date, periodRange(period, offset))),
    PLACES,
  );
  if (places.length === 0) return null;
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);

  return (
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
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  trend: { marginTop: 16, gap: 6 },
  spark: { height: SPARK_HEIGHT },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  end: { fontSize: 11.5 },
  compare: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  compareText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  locked: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  lockedText: { fontSize: 13 },
  places: { marginTop: 18, paddingVertical: 14 },
  placesTitle: { fontSize: 15, marginBottom: 4 },
  place: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  placeName: { fontSize: 14.5 },
  placeMeta: { fontSize: 12, marginTop: 2 },
  placeAmount: { fontSize: 14.5, fontVariant: ["tabular-nums"] },
});
