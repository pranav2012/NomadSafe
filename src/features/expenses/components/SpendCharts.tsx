import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuraCard, Icon, PressableScale, useAura } from "@/atoms";
import { auraStatusAccent } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { usePlusGate } from "@/modules/billing";
import { getTripStatus } from "@/features/trips/utils/dates";
import type { Trip } from "@/features/trips/store/tripsStore";
import { formatMoney } from "@/features/expenses/utils/money";
import { topPlaces, tripDailyTotals, tripPace, type InsightItem } from "@/features/expenses/utils/spendInsights";
import { OWED, OWES } from "@/features/expenses/components/GroupBalances";

const STRIP_HEIGHT = 30;
const PLACES = 5;
const MIN_GROUP_SPENDS = 3;
const MIN_REPEAT_PLACES = 2;

/** What a Plus card shows, as one line that opens the paywall. */
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

/** A started trip's daily pace against its budget, where it lands at this pace, and a strip of days (Plus). */
export function TripPaceCard({ trip, items }: { trip: Trip; items: InsightItem[] }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  const status = getTripStatus(trip);
  if (status === "upcoming" || items.length === 0) return null;
  if (!plus.isPlus) return <PlusChartTeaser text={t("money.tripChartLocked")} />;

  const money = (amount: number) => formatMoney(formatCurrency, amount, trip.currency);
  const pace = tripPace(items, trip);
  const { buckets, before } = tripDailyTotals(items, trip);
  const budget = pace.plannedPerDay !== null ? trip.budget : null;
  const over = budget !== null && pace.projected > budget;
  const dayLimit = pace.plannedPerDay !== null ? pace.plannedPerDay * (buckets[0]?.days ?? 1) : null;
  const max = Math.max(...buckets.map((bucket) => bucket.total), dayLimit ?? 0, 1);

  const outlook =
    status === "complete"
      ? budget !== null
        ? t("money.pace.done", { spent: money(pace.spent), budget: money(budget) })
        : null
      : budget !== null
        ? t(over ? "money.pace.over" : "money.pace.onTrack", { projected: money(pace.projected), budget: money(budget) })
        : t("money.pace.noBudget", { projected: money(pace.projected) });

  return (
    <AuraCard style={styles.card}>
      <Text style={[styles.title, { color: c.textMuted, fontFamily: f.medium }]}>{t("money.pace.title")}</Text>
      <View style={styles.paceRow}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.pace, { color: c.text, fontFamily: f.semibold }]}>{t("money.pace.perDay", { amount: money(pace.perDay) })}</Text>
        {pace.plannedPerDay !== null ? (
          <Text style={[styles.planned, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.pace.budgetPerDay", { amount: money(pace.plannedPerDay) })}</Text>
        ) : null}
      </View>
      {outlook ? (
        <Text style={[styles.outlook, { color: budget === null ? c.textSoft : over ? OWES : OWED, fontFamily: f.medium }]}>{outlook}</Text>
      ) : null}
      {pace.leftPerDay !== null ? (
        <Text style={[styles.line, { color: c.textSoft, fontFamily: f.regular }]}>{t("money.pace.leftPerDay", { amount: money(pace.leftPerDay), count: pace.daysLeft })}</Text>
      ) : null}

      <View style={styles.strip} accessible accessibilityLabel={buckets.map((bucket) => money(bucket.total)).join(", ")}>
        {buckets.map((bucket) => {
          const above = dayLimit !== null && bucket.total > dayLimit;
          return (
            <View key={bucket.day} style={styles.stripColumn}>
              <View
                style={[
                  styles.stripBar,
                  { height: Math.max(2, (bucket.total / max) * STRIP_HEIGHT), backgroundColor: above ? OWES : `${auraStatusAccent.calm}AA` },
                ]}
              />
            </View>
          );
        })}
        {dayLimit !== null ? <View style={[styles.limit, { bottom: (dayLimit / max) * STRIP_HEIGHT, borderColor: c.textMuted }]} /> : null}
      </View>
      {before > 0 ? <Text style={[styles.note, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.beforeTrip", { amount: money(before) })}</Text> : null}
    </AuraCard>
  );
}

/** The places a group spends most at, whole amounts; only once places repeat, since one-off names are just a list of spends (Plus). */
export function GroupPlaces({ items, currency }: { items: InsightItem[]; currency: string }) {
  const { c, f } = useAura();
  const { t, formatCurrency } = useLocalization();
  const plus = usePlusGate();
  const places = topPlaces(items, PLACES);
  if (items.length < MIN_GROUP_SPENDS || places.filter((place) => place.count > 1).length < MIN_REPEAT_PLACES) return null;
  if (!plus.isPlus) return <PlusChartTeaser text={t("money.groupChartLocked")} />;
  const money = (amount: number) => formatMoney(formatCurrency, amount, currency);

  return (
    <AuraCard style={styles.card}>
      <Text style={[styles.title, { color: c.textMuted, fontFamily: f.medium }]}>{t("money.groupPlaces")}</Text>
      {places.map((place, index) => (
        <View key={place.name} style={[styles.place, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}>
          <View style={styles.flex}>
            <Text style={[styles.placeName, { color: c.text, fontFamily: f.regular }]} numberOfLines={1}>
              {place.name}
            </Text>
            <Text numberOfLines={1} style={[styles.placeMeta, { color: c.textMuted, fontFamily: f.regular }]}>{t("money.placeCount", { count: place.count })}</Text>
          </View>
          <Text numberOfLines={1} style={[styles.placeAmount, { color: c.text, fontFamily: f.medium }]}>
            {money(place.amount)}
          </Text>
        </View>
      ))}
    </AuraCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { marginTop: 18, gap: 6 },
  title: { fontSize: 13.5 },
  paceRow: { flexDirection: "row", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  pace: { flexShrink: 1, fontSize: 24, letterSpacing: -0.6 },
  planned: { fontSize: 13.5 },
  outlook: { fontSize: 14.5, lineHeight: 20 },
  line: { fontSize: 13.5, lineHeight: 19 },
  strip: { height: STRIP_HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: 3, marginTop: 10 },
  stripColumn: { flex: 1, justifyContent: "flex-end" },
  stripBar: { width: "100%", borderRadius: 2 },
  limit: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dashed" },
  note: { fontSize: 12.5, marginTop: 4 },
  place: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  placeName: { fontSize: 14.5 },
  placeMeta: { fontSize: 12, marginTop: 2 },
  placeAmount: { maxWidth: "45%", fontSize: 14.5, fontVariant: ["tabular-nums"] },
  lockedWrap: { marginTop: 18 },
  locked: { flexDirection: "row", alignItems: "center", gap: 10 },
  lockedText: { flex: 1, fontSize: 14 },
});
