import React from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { AuraButton, Icon, PressableScale, useAura } from "@/atoms";
import { auraEventColors, auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import type { Trip } from "@/features/trips/store/tripsStore";
import { countInclusiveDays, fromDateKey, toDateKey } from "@/features/trips/utils/dates";
import { useTripPlanContext } from "@/features/itinerary/hooks/useTripPlanContext";
import type { TripEvent } from "@/features/itinerary/store/eventsStore";
import { dayEntries, tripGlance, type GlanceDay } from "@/features/itinerary/utils/dayShape";
import { describeEntry, formatters, routeOf } from "@/features/itinerary/utils/entryText";
import { localizeEventTitle } from "@/features/itinerary/utils/eventText";
import { isForMe } from "@/features/itinerary/utils/people";
import { transitModeOf } from "@/features/itinerary/utils/transit";

const PREVIEW_ITEMS = 3;

type Translate = ReturnType<typeof useLocalization>["t"];

/** Pushes the full plan screen, for the whole trip or one day. */
export function useOpenTripPlan(trip: Trip) {
  const router = useRouter();
  return (from: "home" | "rail" | "day", day?: Date) => {
    track("trip_plan_opened", { from, days: countInclusiveDays(fromDateKey(trip.startDate), fromDateKey(trip.endDate)), scope: day ? "day" : "trip" });
    router.push({ pathname: "/trip-plan/[id]", params: { id: trip.id, ...(day ? { date: toDateKey(day) } : null) } });
  };
}

/** The day-by-day summary of a trip: one `GlanceDay` per trip day. */
export function useTripGlance(trip: Trip) {
  const context = useTripPlanContext(trip);
  const glance = tripGlance(context.tripEvents, context.days, {
    mealsOn: context.mealsOn,
    learned: context.learned,
    homeCountry: context.homeCountry,
    missingOf: context.missingOf,
  });
  return { context, glance };
}

/** One-line headline for a day: the landing, else its first stops, else "Free day". */
export function glanceHeadline(day: GlanceDay<TripEvent>, t: Translate, format: ReturnType<typeof formatters>) {
  if (day.arrival) {
    const place = routeOf(day.arrival.event.detail).split(" → ")[1] ?? localizeEventTitle(day.arrival.event.title, t);
    const time = format.time.format(new Date(day.arrival.at));
    return transitModeOf(day.arrival.event) === "flight" ? t("itinerary.glance.lands", { place, time }) : `${place} · ${t("itinerary.arrives", { time })}`;
  }
  const titles = day.items
    .filter((event) => event.type !== "stay" && event.type !== "note")
    .map((event) => (event.type === "transit" ? routeOf(event.detail) || localizeEventTitle(event.title, t) : localizeEventTitle(event.title, t)));
  if (titles.length === 0) return t("itinerary.glance.freeDay");
  return titles.slice(0, 2).join(" → ") + (titles.length > 2 ? ` +${titles.length - 2}` : "");
}

/** Facts under a day's title ("Sleep at Gracery · 23 km · 2 h free") and what still needs adding. */
export function useGlanceFacts() {
  const { t, formatDistance, formatCountdown } = useLocalization();
  return (day: GlanceDay<TripEvent>) => ({
    facts: [
      day.tonight ? t("itinerary.glance.tonight", { name: localizeEventTitle(day.tonight.title, t) }) : null,
      day.km >= 0.5 ? formatDistance(day.km) : null,
      day.freeMinutes >= 60 ? t("itinerary.glance.free", { duration: formatCountdown(day.freeMinutes) }) : null,
    ].filter((fact): fact is string => Boolean(fact)),
    warnings: [day.needsStay ? t("itinerary.glance.noStay") : null, day.missing > 0 ? t("itinerary.glance.missing", { count: day.missing }) : null].filter(
      (warning): warning is string => Boolean(warning),
    ),
  });
}

/**
 * The day picked on Home's day rail before the trip: its headline, facts, what's missing and the
 * first few items; opens that day in the full plan.
 */
export function GlanceDayCard({ trip, day, index, onAdd }: { trip: Trip; day: GlanceDay<TripEvent> | undefined; index: number; onAdd: () => void }) {
  const { c, f } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const format = formatters(locale, hour12);
  const openPlan = useOpenTripPlan(trip);
  const factsOf = useGlanceFacts();
  if (!day) return null;
  const { facts, warnings } = factsOf(day);
  const preview = dayEntries(day.items.filter(isForMe), day.date).slice(0, PREVIEW_ITEMS);
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(day.date);

  return (
    <PrivateView>
      <PressableScale onPress={() => openPlan("home", day.date)} pressedScale={0.98} accessibilityRole="button" style={[styles.card, { backgroundColor: c.surface }]}>
        <View style={styles.head}>
          <Text style={[styles.dayLabel, { color: c.textMuted, fontFamily: f.semibold }]}>
            {t("itinerary.glance.day", { day: index + 1 })} · {dayLabel}
          </Text>
          <Icon name="chevronRight" size={13} color={c.textMuted} />
        </View>
        <Text numberOfLines={1} style={[styles.headline, { color: c.text, fontFamily: f.semibold }]}>
          {glanceHeadline(day, t, format)}
        </Text>
        {facts.length > 0 ? (
          <Text numberOfLines={1} style={[styles.facts, { color: c.textSoft, fontFamily: f.regular }]}>
            {facts.join(" · ")}
          </Text>
        ) : null}
        {preview.length > 0 ? (
          <View style={styles.preview}>
            {preview.map((entry) => (
              <View key={`${entry.event.id}-${entry.role}`} style={styles.previewRow}>
                <Text style={[styles.previewTime, { color: c.textMuted, fontFamily: f.medium }]}>{format.time.format(new Date(entry.at))}</Text>
                <View style={[styles.dot, { backgroundColor: auraEventColors[entry.event.type] }]} />
                <Text numberOfLines={1} style={[styles.previewTitle, { color: c.text, fontFamily: f.medium }]}>
                  {describeEntry(entry, t, format, day.date.getTime()).title}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {warnings.length > 0 ? (
          <View style={styles.warning}>
            <Icon name="info" size={13} color={auraSignal.amber} />
            <Text numberOfLines={1} style={[styles.facts, { color: auraSignal.amber, fontFamily: f.medium }]}>
              {warnings.join(" · ")}
            </Text>
          </View>
        ) : null}
      </PressableScale>
      <View style={styles.actions}>
        <AuraButton label={t("itinerary.glance.fullPlan")} icon="calendar" variant="ghost" size="md" onPress={() => openPlan("home")} />
        <AuraButton label={t("itinerary.add")} icon="plus" variant="ghost" size="md" onPress={onAdd} />
      </View>
    </PrivateView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayLabel: { fontSize: 11.5, letterSpacing: 0.6, textTransform: "uppercase" },
  headline: { fontSize: 17, letterSpacing: -0.2, marginTop: 2 },
  facts: { flexShrink: 1, fontSize: 13 },
  preview: { gap: 6, marginTop: 10 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewTime: { width: 44, fontSize: 12, fontVariant: ["tabular-nums"] },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  previewTitle: { flex: 1, fontSize: 13.5 },
  warning: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  actions: { flexDirection: "row", justifyContent: "center", gap: 4, marginTop: 4 },
});
