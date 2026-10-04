import React, { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PostHogMaskView } from "posthog-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { AuraButton } from "@/components/aura/AuraButton";
import { useAura } from "@/components/aura/useAura";
import { useTabBarInset } from "@/components/tabbar/tabBarInset";
import { useScrollActivity } from "@/hooks/useScrollActivity";
import { auraStatusAccent } from "@/constants/aura";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import { useLocalization } from "@/localization";
import { Globe } from "./aura/globe/Globe";

/** Home before any trip: the spinning globe with "Where to first?"; the search opens the trip planner. */
export function EmptyHome({ tripCount, onViewTrips, onPlanTrip }: { tripCount: number; onViewTrips: () => void; onPlanTrip: () => void }) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const [globeTouched, setGlobeTouched] = useState(false);
  const { scrolling, onScroll } = useScrollActivity();
  const globe = useGlobeContext(undefined);
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
        <PostHogMaskView style={{ height: globeHeight + insets.top + 8 }}>
          <Animated.View entering={FadeIn.duration(600)}>
            <Globe
              stops={[]}
              focusIndex={0}
              width={width}
              height={globeHeight + insets.top + 8}
              topInset={insets.top + 8}
              origin={globe.origin}
              contacts={[]}
              contactColor="#3DDC97"
              accent={auraStatusAccent.calm}
              isDark={isDark}
              onTouchActive={setGlobeTouched}
              scrolling={scrolling}
              overview
            />
          </Animated.View>
          <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.globeFade} />
        </PostHogMaskView>

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
});
