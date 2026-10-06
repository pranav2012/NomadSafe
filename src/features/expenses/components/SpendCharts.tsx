import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraCard, Icon, PressableScale, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { getTripStatus } from "@/features/trips/utils/dates";
import type { Trip } from "@/features/trips/store/tripsStore";
import { formatMoney } from "@/features/expenses/utils/money";
import { monthlyTotals } from "@/features/expenses/utils/myMoney";
import { monthsOfHistory, tripDailyTotals, type InsightItem } from "@/features/expenses/utils/spendInsights";

const BAR_HEIGHT = 96;
const MONTHS = 6;
const GROUP_CHART_AFTER_MS = 30 * 86_400_000;

export interface SpendBar {
  key: string;
  label: string;
  total: number;
  segments?: { color: string; amount: number }[];
  highlight?: boolean;
  value?: string;
  onPress?: () => void;
  accessibilityLabel: string;
}

/** A card of vertical bars; stacked when bars carry segments. */
export function SpendBars({ title, aside, bars, footer, children }: { title: string; aside?: string; bars: SpendBar[]; footer?: string[]; children?: React.ReactNode }) {
  const { c, f } = useAura();
  const max = Math.max(...bars.map((bar) => bar.total), 1);
  const thin = bars.length > 12;

  return (
    <AuraCard style={styles.card}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{title}</Text>
        {aside ? <Text style={[styles.aside, { color: c.textMuted, fontFamily: f.regular }]}>{aside}</Text> : null}
      </View>
      <View style={[styles.bars, { gap: thin ? 3 : 8 }]}>
        {bars.map((bar) => {
          const height = bar.total > 0 ? Math.max(3, (bar.total / max) * BAR_HEIGHT) : 3;
          const faded = !bar.highlight;
          const column = (
            <>
              {bar.value ? (
                <Text style={[styles.value, { color: c.text, fontFamily: f.medium }]} numberOfLines={1}>
                  {bar.value}
                </Text>
              ) : null}
              <View style={[styles.track, { height: BAR_HEIGHT }]}>
                <View style={[styles.bar, { height, borderRadius: thin ? 3 : 6, backgroundColor: bar.segments ? c.surfaceStrong : faded ? `${auraStatusAccent.calm}55` : auraStatusAccent.calm }]}>
                  {bar.segments?.map((segment, index) => (
                    <View key={index} style={{ height: (segment.amount / bar.total) * height, backgroundColor: segment.color, opacity: faded ? 0.45 : 1 }} />
                  ))}
                </View>
              </View>
              <Text style={[styles.label, { color: bar.highlight ? c.text : c.textMuted, fontFamily: f.regular }]} numberOfLines={1}>
                {bar.label}
              </Text>
            </>
          );
          return bar.onPress ? (
            <PressableScale key={bar.key} haptic={false} onPress={bar.onPress} accessibilityRole="button" accessibilityLabel={bar.accessibilityLabel} style={styles.column}>
              {column}
            </PressableScale>
          ) : (
            <View key={bar.key} accessible accessibilityLabel={bar.accessibilityLabel} style={styles.column}>
              {column}
            </View>
          );
        })}
      </View>
      {footer?.map((line) => (
        <Text key={line} style={[styles.footer, { color: c.textSoft, fontFamily: f.regular }]}>
          {line}
        </Text>
      ))}
      {children}
    </AuraCard>
  );
}

/** What a Plus chart shows, as a card that opens the paywall. */
export function PlusChartTeaser({ text }: { text: string }) {
  const { c, f } = useAura();
  const plus = usePlusGate();
  return (
    <PressableScale onPress={() => plus.run("charts", () => undefined)} pressedScale={0.98} accessibilityRole="button" style={styles.lockedWrap}>
      <AuraCard style={styles.locked}>
        <Icon name="lock" size={16} color={c.textSoft} />
        <Text style={[styles.lockedText, { color: c.textSoft, fontFamily: f.regular }]}>{text}</Text>
        <Icon name="chevronRight" size={14} color={c.textMuted} />
      </AuraCard>
    </PressableScale>
  );
}

/** A trip's spend day by day (weeks on long trips), once it has started (Plus). */
export function TripDaysChart({ trip, items }: { trip: Trip; items: InsightItem[] }) {
  const { t, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  if (getTripStatus(trip) === "upcoming") return null;
  if (!plus.isPlus) return <PlusChartTeaser text={t("money.tripChartLocked")} />;

  const money = (amount: number) => formatMoney(formatCurrency, amount, trip.currency);
  const { buckets, step, before } = tripDailyTotals(items, trip);
  const spent = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  if (spent <= 0) return null;
  const weekly = step > 1;
  const days = buckets.reduce((sum, bucket) => sum + bucket.days, 0);
  const priciest = buckets.reduce((top, bucket) => (bucket.total > top.total ? bucket : top), buckets[0]);
  const number = (bucket: (typeof buckets)[number]) => (weekly ? Math.ceil(bucket.day / 7) : bucket.day);
  const labelEvery = weekly ? 1 : buckets.length > 14 ? 7 : buckets.length > 7 ? 2 : 1;

  const bars: SpendBar[] = buckets.map((bucket, index) => ({
    key: String(bucket.day),
    label: index % labelEvery === 0 || index === buckets.length - 1 ? (weekly ? t("money.weekShort", { n: number(bucket) }) : String(bucket.day)) : "",
    total: bucket.total,
    highlight: bucket === priciest,
    accessibilityLabel: `${weekly ? t("money.weekShort", { n: number(bucket) }) : t("money.dayN", { n: bucket.day })} ${money(bucket.total)}`,
  }));
  const footer = [
    weekly ? t("money.priciestWeek", { n: number(priciest), amount: money(priciest.total) }) : t("money.priciestDay", { n: priciest.day, amount: money(priciest.total) }),
    before > 0 ? t("money.beforeTrip", { amount: money(before) }) : null,
  ].filter((line): line is string => !!line);

  return (
    <SpendBars
      title={weekly ? t("money.weekByWeek") : t("money.dayByDay")}
      aside={weekly ? t("money.perWeek", { amount: money((spent / days) * 7) }) : t("money.perDay", { amount: money(spent / days) })}
      bars={bars}
      footer={footer}
    />
  );
}

/** A group's spend month by month, once it's at least a month old (Plus). */
export function GroupMonthsChart({ createdAt, items, currency }: { createdAt: string; items: InsightItem[]; currency: string }) {
  const { t, locale, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  const [now] = React.useState(() => Date.now());
  const first = Math.min(new Date(createdAt).getTime(), ...items.map((item) => new Date(item.date).getTime()));
  if (items.length === 0 || now - first < GROUP_CHART_AFTER_MS) return null;
  if (!plus.isPlus) return <PlusChartTeaser text={t("money.groupChartLocked")} />;

  const count = Math.min(MONTHS, Math.max(2, monthsOfHistory([{ date: new Date(first).toISOString() }])));
  const months = monthlyTotals(items, count);
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);
  const monthName = (date: Date) => new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  const average = months.reduce((sum, month) => sum + month.total, 0) / count;

  return (
    <SpendBars
      title={t("money.monthByMonth")}
      aside={t("money.trendAverage", { amount: money(average) })}
      bars={months.map((month, index) => {
        const current = index === months.length - 1;
        return {
          key: month.start.toISOString(),
          label: monthName(month.start),
          total: month.total,
          highlight: current,
          value: current && month.total > 0 ? money(month.total) : undefined,
          accessibilityLabel: `${monthName(month.start)} ${money(month.total)}`,
        };
      })}
    />
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 18, gap: 14 },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 15 },
  aside: { fontSize: 12.5 },
  bars: { flexDirection: "row", alignItems: "flex-end" },
  column: { flex: 1, alignItems: "center", gap: 6 },
  track: { width: "100%", justifyContent: "flex-end" },
  value: { fontSize: 11.5 },
  bar: { width: "100%", overflow: "hidden", justifyContent: "flex-end", flexDirection: "column-reverse" },
  label: { fontSize: 11.5 },
  footer: { fontSize: 13, lineHeight: 18, marginTop: -4 },
  lockedWrap: { marginTop: 18 },
  locked: { flexDirection: "row", alignItems: "center", gap: 10 },
  lockedText: { flex: 1, fontSize: 14 },
});
