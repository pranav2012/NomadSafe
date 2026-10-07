import React, { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrivateView } from "@/modules/analytics";
import { LinearGradient } from "expo-linear-gradient";
import { AuraButton, Icon, PressableScale, useAura, useTabBarInset } from "@/atoms";
import { useScrollActivity } from "@/hooks/useScrollActivity";
import { auraStatusAccent } from "@/constants/aura";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import { useLocalization } from "@/localization";
import { PlannedTripCard } from "@/features/trips/components/PlannedTripCard";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { FREE_PLANNED_LIMIT, ownedTripCount, usePlan } from "@/modules/billing";
import { Globe, type GlobeStop } from "./aura/globe/Globe";

/** Home without a trip: the spinning globe with "Where to first?" (search opens the planner) and planned trips as dashed cards and pins. */
export function EmptyHome({
  tripCount,
  onViewTrips,
  onPlanTrip,
  everyday,
}: {
  tripCount: number;
  onViewTrips: () => void;
  onPlanTrip: () => void;
  /** Cards for days without a trip (balance, Get home safe). */
  everyday?: React.ReactNode;
}) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const [globeTouched, setGlobeTouched] = useState(false);
  const { scrolling, onScroll } = useScrollActivity();
  const globe = useGlobeContext(undefined);
  const plannedTrips = useTripsStore((state) => state.plannedTrips);
  const { unlimitedTrips } = usePlan();
  const plannedPins: GlobeStop[] = plannedTrips.flatMap((planned) =>
    planned.destinations.flatMap((name, i) => {
      const point = planned.destinationCoordinates?.[i];
      return point ? [{ name, ...point }] : [];
    }),
  );
  const globeHeight = Math.round(width * 0.78);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEnabled={!globeTouched}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: tabBarInset + 24 }}
      >
        <PrivateView style={{ height: globeHeight + insets.top + 8 }}>
          <Animated.View entering={FadeIn.duration(600)}>
            <Globe
              stops={[]}
              focusIndex={0}
              width={width}
              height={globeHeight + insets.top + 8}
              topInset={insets.top + 8}
              origin={globe.origin}
              contacts={[]}
              plannedPins={plannedPins}
              contactColor="#3DDC97"
              accent={auraStatusAccent.calm}
              isDark={isDark}
              onTouchActive={setGlobeTouched}
              scrolling={scrolling}
              overview
            />
          </Animated.View>
          <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.globeFade} />
        </PrivateView>

        <Animated.View entering={FadeInDown.delay(250).duration(420)} style={styles.body}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("trip.createTitle")}</Text>
          <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{t("trip.createBody")}</Text>
          <PressableScale
            onPress={onPlanTrip}
            pressedScale={0.98}
            accessibilityRole="button"
            accessibilityLabel={t("trip.destinationPlaceholder")}
            style={[styles.search, { backgroundColor: c.surface, borderColor: c.hairline }]}
          >
            <Icon name="search" size={20} color={c.textMuted} />
            <Text numberOfLines={1} style={[styles.searchText, { color: c.textMuted, fontFamily: f.medium }]}>
              {t("trip.destinationPlaceholder")}
            </Text>
          </PressableScale>
          {plannedTrips.length > 0 ? (
            <View style={styles.planning}>
              <View style={styles.planningHead}>
                <Text style={[styles.planningTitle, { color: c.text, fontFamily: f.semibold }]}>{t("planned.section")}</Text>
                {unlimitedTrips ? null : (
                  <Text style={[styles.planningCount, { color: c.textMuted, fontFamily: f.regular }]}>
                    {t("planned.sectionCount", { count: ownedTripCount(plannedTrips), limit: FREE_PLANNED_LIMIT })}
                  </Text>
                )}
              </View>
              {plannedTrips.map((planned) => (
                <PlannedTripCard key={planned.id} planned={planned} />
              ))}
            </View>
          ) : null}
          {tripCount > 0 ? (
            <AuraButton
              label={t("trip.viewExistingTrips", { count: tripCount })}
              icon="swap"
              variant="ghost"
              size="md"
              onPress={onViewTrips}
              style={styles.existing}
            />
          ) : null}
          {everyday}
        </Animated.View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  globeFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 72 },
  body: { paddingHorizontal: 20, gap: 12, marginTop: -8 },
  title: { fontSize: 34, letterSpacing: -1.2, lineHeight: 38 },
  lede: { fontSize: 15, lineHeight: 22, marginBottom: 6 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  searchText: { flex: 1, fontSize: 18 },
  existing: { alignSelf: "flex-start", marginTop: 4 },
  planning: { gap: 10, marginTop: 10 },
  planningHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  planningTitle: { fontSize: 17, letterSpacing: -0.2 },
  planningCount: { fontSize: 12.5 },

});
