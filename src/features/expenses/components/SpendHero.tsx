import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Group, Rect, RoundedRect, Skia, usePathValue } from "react-native-skia";
import { Easing, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { RollingNumber, useAura } from "@/atoms";
import { auraCategoryColors } from "@/constants/aura";
import { useLocalization } from "@/localization";
import type { ExpenseCategory } from "@/features/expenses/constants/categories";
import { formatMoney } from "@/features/expenses/utils/money";

export interface SpendHeroProps {
  label: string | null;
  currency: string;
  total: number;
  daysLeft: number;
  breakdown: { category: ExpenseCategory; amount: number }[];
  note: string | null;
  /** Replaces "spent so far" under the number. */
  caption?: string;
  /** A second line under the caption, e.g. the group's total. */
  detail?: string | null;
}

const BAR_H = 10;
const NUMBER_SIZE = 50;
const NUMBER_LINE = 58;

/** Total spent so far, with a category breakdown bar and legend. */
export function SpendHero({ label, currency, total, daysLeft, breakdown, note, caption, detail }: SpendHeroProps) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);

  const meta = [label ?? t("expenses.allTime"), daysLeft > 0 ? t("expenses.daysLeft", { count: daysLeft }) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.root}>
      <Text style={[styles.meta, { color: c.textMuted, fontFamily: f.medium }]} numberOfLines={1}>
        {meta}
      </Text>
      <RollingNumber
        value={money(total)}
        lineHeight={NUMBER_LINE}
        style={[styles.number, { color: c.text, fontFamily: f.semibold }]}
      />
      <Text style={[styles.caption, { color: c.textSoft, fontFamily: f.regular }]}>{caption ?? t("expenses.spentSoFar")}</Text>
      {detail ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{detail}</Text> : null}

      {breakdown.length > 0 ? (
        <>
          <CategoryBar total={total} breakdown={breakdown} track={c.surfaceStrong} />
          <View style={styles.legend}>
            {breakdown.slice(0, 4).map((entry) => (
              <View key={entry.category} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: auraCategoryColors[entry.category] }]} />
                <Text style={[styles.small, { color: c.textMuted, fontFamily: f.regular }]}>{t(`expenses.category.${entry.category}`)}</Text>
                <Text style={[styles.small, { color: c.text, fontFamily: f.medium }]}>{money(entry.amount)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {note ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{note}</Text> : null}
    </View>
  );
}

/** Category segments filling the total, wiping in from the left. */
function CategoryBar({
  total,
  breakdown,
  track,
}: {
  total: number;
  breakdown: { category: ExpenseCategory; amount: number }[];
  track: string;
}) {
  const [width, setWidth] = useState(0);
  const reveal = useSharedValue(0);
  const scale = Math.max(total, 1);

  useEffect(() => {
    if (width === 0) return;
    reveal.set(0);
    reveal.set(withDelay(150, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [reveal, width, total]);

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
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: 6 },
  meta: { fontSize: 14 },
  number: { fontSize: NUMBER_SIZE, letterSpacing: -1.8, marginTop: 6 },
  caption: { fontSize: 15, marginTop: 2 },
  bar: { height: BAR_H + 8, marginTop: 22 },
  small: { fontSize: 13 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 6, marginTop: 12 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  note: { fontSize: 12.5, marginTop: 10 },
});
