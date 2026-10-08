import React, { useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, PressableScale, useAura } from "@/atoms";
import { auraSignal } from "@/constants/aura";
import { useLocalization } from "@/localization";
import { PrivateView, track } from "@/modules/analytics";
import { useNow } from "@/hooks/useNow";
import { DayRail } from "@/features/home/components/aura/DayRail";
import { useTripsStore, type Trip } from "@/features/trips/store/tripsStore";
import { toDateKey } from "@/features/trips/utils/dates";
import { DayPlan, type FreeGap } from "@/features/itinerary/components/DayPlan";
import { GapSheet } from "@/features/itinerary/components/GapSheet";
import { glanceHeadline, useGlanceFacts, useTripGlance } from "@/features/itinerary/components/TripGlance";
import { TripPlanMap } from "@/features/itinerary/components/TripPlanMap";
import { TravelDayCard } from "@/features/itinerary/components/TravelDayCard";
import { defaultStartFor, useItineraryEditor } from "@/features/itinerary/hooks/useItineraryEditor";
import { useItineraryPlaces } from "@/features/itinerary/hooks/useItineraryPlaces";
import { livePlan } from "@/features/itinerary/utils/dayPlan";
import { formatters } from "@/features/itinerary/utils/entryText";
import { dateTimeFormat } from "@/utils/intl";
import { planPins } from "@/features/itinerary/utils/planPins";

const MAP_SHARE = 0.34;
const MAP_MAX = 320;
const MAP_MIN = 120;
// Scrolling this far collapses the map to its strip.
const COLLAPSE_DISTANCE = 260;
// A day counts as "in view" once its header passes this far below the top of the list.
const ACTIVE_OFFSET = 80;

/** The whole trip, day after day, under a map that follows the day you're reading; `date` opens on that day. */
export default function TripPlanScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const trip = useTripsStore((state) => state.trips.find((item) => item.id === id) ?? null);
  return trip ? <TripPlan trip={trip} initialDate={date} /> : null;
}

function TripPlan({ trip, initialDate }: { trip: Trip; initialDate?: string }) {
  const { c, f, isDark, accent } = useAura();
  const { t, locale, hour12 } = useLocalization();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const now = useNow();
  const { context, glance } = useTripGlance(trip);
  const factsOf = useGlanceFacts();
  const editor = useItineraryEditor(trip);
  useItineraryPlaces(trip);
  const [gap, setGap] = useState<FreeGap | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const offsets = useRef<number[]>([]);
  const dayRefs = useRef<(View | null)[]>([]);
  const contentRef = useRef<View>(null);
  const initialIndex = Math.max(0, initialDate ? context.days.findIndex((day) => toDateKey(day) === initialDate) : 0);
  const [active, setActive] = useState(initialIndex);
  const jumped = useRef(false);
  const format = formatters(locale, hour12);

  const current = livePlan(context.tripEvents, now.getTime()).current;
  const todayIndex = context.days.findIndex((day) => day.toDateString() === now.toDateString());
  const byDay = planPins(context.tripEvents, context.days);
  const itemPins = byDay.flatMap((day, i) => day.pins.map((pin) => ({ ...pin, id: `${i}-${pin.id}`, dim: i !== active })));
  // Until items have places, the map shows the trip's cities.
  const pins =
    itemPins.length > 0
      ? itemPins
      : context.stops.map((stop, i) => ({ ...stop, id: `stop-${i}`, label: String(i + 1), type: "stay" as const, dim: stop.name !== context.stopOn(context.days[active] ?? context.days[0])?.name }));
  const activeStop = context.stopOn(context.days[active] ?? context.days[0]);
  const focus = byDay[active]?.pins.length ? byDay[active].pins : activeStop ? [activeStop] : [];
  const mapHeight = Math.min(MAP_MAX, Math.round(height * MAP_SHARE));
  const dayHeader = dateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric" });
  const shortDate = dateTimeFormat(locale, { month: "short", day: "numeric" });
  const shown = scrub ?? active;
  const shownStop = context.stopOn(context.days[shown] ?? context.days[0]);

  const scrollY = useSharedValue(0);
  const mapStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.get(), [0, COLLAPSE_DISTANCE], [mapHeight, MAP_MIN], Extrapolation.CLAMP),
  }));
  // The map keeps its full size and is clipped, so it only slides instead of re-laying out every frame.
  const mapInnerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -interpolate(scrollY.get(), [0, COLLAPSE_DISTANCE], [0, (mapHeight - MAP_MIN) / 2], Extrapolation.CLAMP) }],
  }));

  // Positions are measured when needed: onLayout can miss a day moving when the days above it grow.
  const measureDay = (index: number, done: (y: number) => void) => {
    const day = dayRefs.current[index];
    const content = contentRef.current;
    if (!day || !content) return;
    day.measureLayout(content, (_x, y) => {
      offsets.current[index] = y;
      done(y);
    });
  };
  const refreshOffsets = () => context.days.forEach((_, index) => measureDay(index, () => {}));
  const scrollToDay = (index: number) => {
    setActive(index);
    measureDay(index, (y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }));
  };

  const followScroll = (y: number) => {
    let index = 0;
    offsets.current.forEach((offset, i) => {
      if (offset <= y + ACTIVE_OFFSET) index = i;
    });
    setActive((current) => (current === index ? current : index));
  };
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
      scheduleOnRN(followScroll, event.contentOffset.y);
    },
  });

  return (
    <View style={[styles.flex, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t("common.back")} style={[styles.round, { backgroundColor: c.surfaceStrong }]}>
          <Icon name="chevronLeft" size={18} color={c.text} />
        </PressableScale>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
            {trip.name}
          </Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: c.textMuted, fontFamily: f.regular }]}>
            {t("itinerary.plan.subtitle", { count: context.days.length })}
          </Text>
        </View>
        <PressableScale
          onPress={() => editor.add(defaultStartFor(context.days[active], now.getTime()))}
          accessibilityRole="button"
          accessibilityLabel={t("itinerary.add")}
          style={[styles.round, { backgroundColor: c.surfaceStrong }]}
        >
          <Icon name="plus" size={18} color={c.text} />
        </PressableScale>
      </View>

      <PrivateView>
        <Animated.View style={[styles.mapClip, { backgroundColor: c.surface }, mapStyle]}>
          {pins.length > 0 ? (
            <Animated.View style={mapInnerStyle}>
              <TripPlanMap pins={pins} paths={itemPins.length > 0 ? byDay.map((day) => day.path) : [context.stops]} focus={focus} height={mapHeight} minDelta={itemPins.length > 0 ? 0.02 : 0.3} />
            </Animated.View>
          ) : (
            <View style={styles.mapEmpty}>
              <Icon name="mapPin" size={16} color={c.textMuted} />
              <Text style={[styles.mapEmptyText, { color: c.textMuted, fontFamily: f.regular }]}>{t("itinerary.plan.noPins")}</Text>
            </View>
          )}
        </Animated.View>
      </PrivateView>

      <View style={styles.rail}>
        <DayRail
          totalDays={context.days.length}
          today={todayIndex + 1}
          selected={active}
          onScrub={setScrub}
          onSelect={(index) => {
            track("itinerary_day_viewed", { relative_day: index - Math.max(0, todayIndex) });
            scrollToDay(index);
          }}
          levels={glance.map((day) => day.load)}
          height={40}
          colors={{
            past: c.textSoft,
            future: isDark ? "rgba(255,255,255,0.2)" : "rgba(14,16,24,0.16)",
            today: accent,
            selected: c.text,
          }}
        />
        <View style={styles.railLabels}>
          <Text style={[styles.railEdge, { color: c.textMuted, fontFamily: f.medium }]}>{context.days[0] ? shortDate.format(context.days[0]) : ""}</Text>
          <Text numberOfLines={1} style={[styles.railCaption, { color: c.text, fontFamily: f.semibold }]}>
            {t("itinerary.glance.day", { day: shown + 1 })}
            {shownStop ? ` · ${shownStop.name.split(",")[0]}` : ""}
          </Text>
          <Text style={[styles.railEdge, { color: c.textMuted, fontFamily: f.medium }]}>
            {context.days.length > 0 ? shortDate.format(context.days[context.days.length - 1]) : ""}
          </Text>
        </View>
      </View>

      <PrivateView style={styles.flex}>
        <Animated.ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onScrollEndDrag={refreshOffsets}
          onMomentumScrollEnd={refreshOffsets}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        >
          <View ref={contentRef} style={styles.days}>
            {context.days.map((day, index) => {
              const stop = context.stopOn(day);
              const { facts, warnings } = glance[index] ? factsOf(glance[index]) : { facts: [], warnings: [] };
              return (
                <View
                  key={day.getTime()}
                  ref={(view) => {
                    dayRefs.current[index] = view;
                  }}
                  style={styles.day}
                  onLayout={(event) => {
                    offsets.current[index] = event.nativeEvent.layout.y;
                    if (!jumped.current && index === initialIndex && initialIndex > 0) {
                      jumped.current = true;
                      setTimeout(() => scrollToDay(initialIndex), 300);
                    }
                  }}
                >
                  <View style={styles.dayHead}>
                    <View style={styles.dayTitleRow}>
                      <Text style={[styles.dayNumber, { color: index === todayIndex ? accent : c.textMuted, fontFamily: f.semibold }]}>
                        {index === todayIndex ? t("home.live.todayTitle") : t("itinerary.glance.day", { day: index + 1 })}
                      </Text>
                      {stop ? <Text style={[styles.dayStop, { color: c.textMuted, fontFamily: f.regular }]}>{stop.name.split(",")[0]}</Text> : null}
                    </View>
                    <Text style={[styles.dayTitle, { color: c.text, fontFamily: f.semibold }]}>{dayHeader.format(day)}</Text>
                    {glance[index] && glance[index].items.length > 0 ? (
                      <Text numberOfLines={1} style={[styles.dayFacts, { color: c.textSoft, fontFamily: f.regular }]}>
                        {[glanceHeadline(glance[index], t, format), ...facts.slice(1)].join(" · ")}
                      </Text>
                    ) : null}
                    {warnings.length > 0 ? (
                      <Text numberOfLines={1} style={[styles.dayFacts, { color: auraSignal.amber, fontFamily: f.medium }]}>
                        {warnings.join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                  <TravelDayCard
                    events={context.tripEvents}
                    day={day}
                    now={now}
                    homeCountry={context.homeCountry}
                    ticketEventIds={context.ticketEventIds}
                    onOpenTicket={editor.openTickets}
                    onEdit={editor.edit}
                  />
                  <DayPlan
                    events={context.tripEvents}
                    day={day}
                    now={now}
                    city={stop?.name.split(",")[0]}
                    meals={context.mealsOn(day)}
                    learned={context.learned}
                    homeCountry={context.homeCountry}
                    placeFailedIds={context.placeFailedIds}
                    ticketEventIds={context.ticketEventIds}
                    onOpenTickets={editor.openTickets}
                    onAskForTicket={editor.askForTicket}
                    onPress={editor.edit}
                    onToggleDone={editor.toggleDone}
                    onAdd={() => editor.add(defaultStartFor(day, now.getTime()))}
                    onGap={setGap}
                    current={current}
                  />
                </View>
              );
            })}
          </View>
        </Animated.ScrollView>
      </PrivateView>

      <GapSheet trip={trip} events={context.tripEvents} gap={gap} onClose={() => setGap(null)} />
      {editor.form}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  round: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17 },
  subtitle: { fontSize: 12.5, marginTop: 1 },
  mapClip: { overflow: "hidden", marginHorizontal: 16, borderRadius: 22 },
  mapEmpty: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 24 },
  mapEmptyText: { fontSize: 13, flexShrink: 1 },
  rail: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  railLabels: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 },
  railEdge: { fontSize: 12, fontVariant: ["tabular-nums"] },
  railCaption: { flexShrink: 1, fontSize: 13 },
  list: { paddingHorizontal: 20, paddingTop: 12 },
  days: { gap: 30 },
  day: { gap: 12 },
  dayHead: { gap: 2 },
  dayTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dayNumber: { fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase" },
  dayStop: { fontSize: 12.5 },
  dayTitle: { fontSize: 20, letterSpacing: -0.3 },
  dayFacts: { fontSize: 13, marginTop: 2 },
});
