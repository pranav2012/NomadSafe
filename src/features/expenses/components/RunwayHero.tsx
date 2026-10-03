import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Canvas, Group, Line, Rect, RoundedRect, Skia, usePathValue, vec } from "react-native-skia";
import { Easing, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { AuraChip } from "@/components/aura/AuraChip";
import { useAura } from "@/components/aura/useAura";
import { RollingNumber } from "@/components/motion/RollingNumber";
import { auraCategoryColors, auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { formatMoney } from "@/features/expenses/utils/money";
import { selectionChanged } from "@/utils/haptics";

export interface RunwayHeroProps {
  label: string | null;
  currency: string;
  total: number;
  budget: number;
  daysLeft: number;
  elapsed: number;
  avgPerDay: number;
  breakdown: { category: ExpenseCategory; amount: number }[];
  note: string | null;
  onSetBudget?: () => void;
}

const BAR_H = 10;
const NUMBER_SIZE = 50;
const NUMBER_LINE = 58;

/** Daily runway (budget left per remaining day), tapping over to the total; total and average without a budget. */
export function RunwayHero({ label, currency, total, budget, daysLeft, elapsed, avgPerDay, breakdown, note, onSetBudget }: RunwayHeroProps) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const [showTotal, setShowTotal] = useState(false);
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);

  const remaining = budget - total;
  const hasRunway = budget > 0 && daysLeft > 0;
  const over = budget > 0 && remaining < 0;
  const runwayMode = hasRunway && !showTotal;

  const headline = runwayMode ? (over ? money(-remaining) : money(remaining / daysLeft)) : money(total);
  const caption = runwayMode
    ? over
      ? t("expenses.overBudgetCaption")
      : t("expenses.runwayCaption")
    : budget > 0
      ? t("expenses.spentSoFar")
      : t("expenses.avgDaily", { amount: money(avgPerDay) });
  const meta = [label ?? t("expenses.allTime"), daysLeft > 0 ? t("expenses.daysLeft", { count: daysLeft }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.root}>
      <Pressable
        disabled={!hasRunway}
        onPress={() => {
          selectionChanged();
          setShowTotal((value) => !value);
        }}
        accessibilityRole={hasRunway ? "button" : undefined}
        accessibilityHint={hasRunway ? t("expenses.heroToggleA11y") : undefined}
      >
        <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.medium }]} numberOfLines={1}>
          {meta}
        </Text>
        <View style={styles.numberRow}>
          <RollingNumber
            value={headline}
            lineHeight={NUMBER_LINE}
            style={[styles.number, { color: over && runwayMode ? auraStatusAccent.alert : c.text, fontFamily: f.semibold }]}
          />
          {runwayMode && !over ? <Text style={[styles.perDay, { color: c.textMuted, fontFamily: f.medium }]}>{t("expenses.perDay")}</Text> : null}
        </View>
        <Text style={[styles.caption, { color: c.textSoft, fontFamily: f.regular }]}>{caption}</Text>
      </Pressable>

      {breakdown.length > 0 || budget > 0 ? (
        <BudgetBar
          budget={budget}
          total={total}
          elapsed={budget > 0 && daysLeft > 0 ? elapsed : null}
          breakdown={breakdown}
          track={c.surfaceStrong}
          tick={c.text}
        />
      ) : null}

      <View style={styles.footer}>
        {budget > 0 ? (
          <Text style={[styles.small, { color: c.textSoft, fontFamily: f.medium }]}>
            {t("expenses.spentOfBudget", { spent: money(total), budget: money(budget) })}
          </Text>
        ) : onSetBudget ? (
          <AuraChip label={t("expenses.setBudget")} icon="plus" onPress={onSetBudget} />
        ) : null}
      </View>

      {breakdown.length > 0 ? (
        <View style={styles.legend}>
          {breakdown.slice(0, 4).map((entry) => (
            <View key={entry.category} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: auraCategoryColors[entry.category] }]} />
              <Text style={[styles.small, { color: c.textMuted, fontFamily: f.regular }]}>{t(`expenses.category.${entry.category}`)}</Text>
              <Text style={[styles.small, { color: c.text, fontFamily: f.medium }]}>{money(entry.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {note ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{note}</Text> : null}
    </View>
  );
}

/** Category segments filling against the budget (or the total), wiping in from the left. */
function BudgetBar({
  budget,
  total,
  elapsed,
  breakdown,
  track,
  tick,
}: {
  budget: number;
  total: number;
  elapsed: number | null;
  breakdown: { category: ExpenseCategory; amount: number }[];
  track: string;
  tick: string;
}) {
  const [width, setWidth] = useState(0);
  const reveal = useSharedValue(0);
  const scale = Math.max(budget, total, 1);

  useEffect(() => {
    if (width === 0) return;
    reveal.set(0);
    reveal.set(withDelay(150, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [reveal, width, total, budget]);

  const clip = usePathValue((builder) => {
    "worklet";
    const w = width * reveal.get();
    builder.moveTo(0, 0).lineTo(w, 0).lineTo(w, BAR_H).lineTo(0, BAR_H).close();
  });

  const rounded = Skia.RRectXY(Skia.XYWHRect(0, 0, width, BAR_H), BAR_H / 2, BAR_H / 2);
  const widths = breakdown.map((entry) => (entry.amount / scale) * width);
  const segments = breakdown.map((entry, index) => ({
    key: entry.category,
    x: widths.slice(0, index).reduce((sum, w) => sum + w, 0),
    w: widths[index],
    color: auraCategoryColors[entry.category],
  }));
  const paceX = elapsed !== null ? Math.min(width - 1, Math.max(1, elapsed * width)) : null;

  return (
    <View style={styles.bar} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <RoundedRect x={0} y={4} width={width} height={BAR_H} r={BAR_H / 2} color={track} />
          <Group transform={[{ translateY: 4 }]} clip={rounded}>
            <Group clip={clip}>
              {segments.map((segment) => (
                <Rect key={segment.key} x={segment.x} y={0} width={Math.max(0, segment.w - 2)} height={BAR_H} color={segment.color} />
              ))}
            </Group>
          </Group>
          {paceX !== null ? <Line p1={vec(paceX, 0)} p2={vec(paceX, BAR_H + 8)} color={tick} strokeWidth={1.5} opacity={0.7} /> : null}
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: 6 },
  meta: { fontSize: 14 },
  numberRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: 6 },
  number: { fontSize: NUMBER_SIZE, letterSpacing: -1.8 },
  perDay: { fontSize: 18, marginBottom: 10 },
  caption: { fontSize: 15, marginTop: 2 },
  bar: { height: BAR_H + 8, marginTop: 22 },
  footer: { flexDirection: "row", alignItems: "center", marginTop: 12, minHeight: 20 },
  small: { fontSize: 13 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  note: { fontSize: 12.5, marginTop: 10 },
});
