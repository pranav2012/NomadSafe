import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Circle, Path, Skia } from "react-native-skia";
import { AuraCard, Icon, PressableScale, useAura } from "@/atoms";
import { auraCategoryColors, auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { formatMoney } from "@/features/expenses/utils/money";
import { inRange, periodRange } from "@/features/expenses/utils/myMoney";
import { monthVsUsual, periodTotals, weekendRatio, type InsightItem } from "@/features/expenses/utils/spendInsights";
import { OWED, OWES } from "@/features/expenses/components/GroupBalances";

const SPARK_HEIGHT = 44;
const DOT = 3.5;
const MONTHS = 6;
const BIGGEST = 3;
const ABOUT = 0.1;

type Change = { key: "above" | "below" | "about" | "new"; pct: number };

function changeOf(amount: number, usual: number | null): Change | null {
  if (usual === null) return null;
  if (usual <= 0) return amount > 0 ? { key: "new", pct: 0 } : null;
  const change = amount / usual - 1;
  if (Math.abs(change) < ABOUT) return { key: "about", pct: 0 };
  return {
    key: change > 0 ? "above" : "below",
    pct: Math.round(Math.abs(change) * 100),
  };
}

/** Under the Overview total (Plus): six months up to the chosen one as a sparkline, and the month against your usual. */
export function OverviewTrend({ items, offset }: { items: InsightItem[]; offset: number }) {
  const { c, f } = useAura();
  const { t, locale } = useLocalization();
  const plus = usePlusGate();

  if (!plus.isPlus) {
    return (
      <PressableScale onPress={() => plus.run("charts", () => undefined)} haptic={false} accessibilityRole="button" style={styles.locked}>
        <Icon name="lock" size={13} color={c.textMuted} />
        <Text style={[styles.lockedText, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.insightsLocked")}</Text>
      </PressableScale>
    );
  }

  const points = periodTotals(items, "month", MONTHS, offset);
  const { total, usualTotal } = monthVsUsual(items, offset);
  const change = changeOf(total, usualTotal);
  const label = (date: Date) => new Intl.DateTimeFormat(locale, { month: "short" }).format(date);

  return (
    <View style={styles.trend}>
      {points.some((point) => point.total > 0) ? (
        <>
          <Sparkline values={points.map((point) => point.total)} color={auraStatusAccent.calm} accessibilityLabel={points.map((point) => label(point.start)).join(", ")} />
          <View style={styles.ends}>
            <Text style={[styles.end, { color: c.textMuted, fontFamily: f.regular }]}>{label(points[0].start)}</Text>
            <Text style={[styles.end, { color: c.textMuted, fontFamily: f.regular }]}>{label(points[points.length - 1].start)}</Text>
          </View>
        </>
      ) : null}
      {change && change.key !== "new" ? (
        <View style={styles.compare}>
          {change.key !== "about" ? <Icon name={change.key === "above" ? "trendUp" : "trendDown"} size={15} color={change.key === "above" ? OWES : OWED} /> : null}
          <Text style={[styles.compareText, { color: c.textSoft, fontFamily: f.regular }]}>{t(`money.usualMonth.${change.key}`, { pct: change.pct })}</Text>
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

  const points = values.map((value, index) => ({
    x: xAt(index),
    y: yAt(value),
  }));
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
  builder
    .lineTo(points[points.length - 1].x, SPARK_HEIGHT)
    .lineTo(points[0].x, SPARK_HEIGHT)
    .close();
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

/** The chosen month by category against your usual, plus your weekend pattern (Plus). */
export function MonthInsights({ items, currency, offset }: { items: InsightItem[]; currency: string; offset: number }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  if (!plus.isPlus) return null;
  const { categories } = monthVsUsual(items, offset);
  const ratio = weekendRatio(items);
  if (categories.length === 0 && ratio === null) return null;
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);
  const top = Math.max(...categories.map((entry) => entry.amount), 1);

  return (
    <AuraCard style={styles.card}>
      <Text style={[styles.cardTitle, { color: c.textMuted, fontFamily: f.medium }]}>{t("money.byCategory")}</Text>
      {categories.map((entry) => {
        const change = changeOf(entry.amount, entry.usual);
        const color = auraCategoryColors[entry.category as keyof typeof auraCategoryColors] ?? c.textMuted;
        return (
          <View key={entry.category} style={styles.category}>
            <View style={styles.categoryRow}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={[styles.categoryName, { color: c.text, fontFamily: f.regular }]} numberOfLines={1}>
                {t(`expenses.category.${entry.category}`)}
              </Text>
              <Text style={[styles.categoryAmount, { color: c.text, fontFamily: f.medium }]}>{money(entry.amount)}</Text>
              {change ? (
                <Text
                  style={[
                    styles.categoryChange,
                    {
                      color: change.key === "above" ? OWES : change.key === "below" ? OWED : c.textMuted,
                      fontFamily: f.regular,
                    },
                  ]}
                  numberOfLines={1}
                >
                  {t(`money.usual.${change.key}`, { pct: change.pct })}
                </Text>
              ) : null}
            </View>
            <View style={[styles.categoryTrack, { backgroundColor: c.surfaceStrong }]}>
              <View
                style={[
                  styles.categoryFill,
                  {
                    width: `${(entry.amount / top) * 100}%`,
                    backgroundColor: color,
                  },
                ]}
              />
            </View>
          </View>
        );
      })}
      {ratio !== null ? (
        <View
          style={[
            styles.weekend,
            categories.length > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: c.hairline,
            },
          ]}
        >
          <Icon name="calendar" size={15} color={c.textSoft} />
          <Text style={[styles.weekendText, { color: c.textSoft, fontFamily: f.regular }]}>
            {ratio > 1 ? t("money.weekendMore", { ratio: ratio.toFixed(1) }) : t("money.weekdayMore", { ratio: (1 / ratio).toFixed(1) })}
          </Text>
        </View>
      ) : null}
    </AuraCard>
  );
}

/** Your largest spends (your share) in the chosen month; each opens the spend (Plus). */
export function BiggestSpends({ items, currency, offset, onOpen }: { items: InsightItem[]; currency: string; offset: number; onOpen: (id: string) => void }) {
  const { c, f } = useAura();
  const { t, locale, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  if (!plus.isPlus) return null;
  const month = periodRange("month", offset);
  const biggest = items
    .filter((item) => item.id && item.amount > 0 && inRange(item.date, month))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, BIGGEST);
  if (biggest.length === 0) return null;
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);
  const day = (date: string) => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(date));

  return (
    <AuraCard style={styles.card}>
      <Text style={[styles.cardTitle, { color: c.textMuted, fontFamily: f.medium }]}>{t("money.biggestSpends")}</Text>
      {biggest.map((item, index) => (
        <PressableScale
          key={item.id}
          haptic={false}
          pressedScale={0.98}
          onPress={() => item.id && onOpen(item.id)}
          accessibilityRole="button"
          style={[
            styles.spend,
            index > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderColor: c.hairline,
            },
          ]}
        >
          <View style={styles.flex}>
            <Text style={[styles.categoryName, { color: c.text, fontFamily: f.regular }]} numberOfLines={1}>
              {item.merchant || t(`expenses.category.${item.category}`)}
            </Text>
            <Text style={[styles.spendMeta, { color: c.textMuted, fontFamily: f.regular }]}>{day(item.date)}</Text>
          </View>
          <Text style={[styles.categoryAmount, { color: c.text, fontFamily: f.medium }]}>{money(item.amount)}</Text>
        </PressableScale>
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
  card: { marginTop: 18, paddingVertical: 14, gap: 2 },
  cardTitle: { fontSize: 13.5, marginBottom: 6 },
  category: { paddingVertical: 7, gap: 7 },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  categoryTrack: {
    height: 4,
    borderRadius: 2,
    marginLeft: 18,
    overflow: "hidden",
  },
  categoryFill: { height: 4, borderRadius: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  categoryName: { flex: 1, fontSize: 14.5 },
  categoryAmount: { fontSize: 14.5, fontVariant: ["tabular-nums"] },
  categoryChange: { fontSize: 12.5, minWidth: 92, textAlign: "right" },
  weekend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 12,
    marginTop: 6,
  },
  weekendText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  spend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  spendMeta: { fontSize: 12, marginTop: 2 },
});
