import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PostHogMaskView } from "posthog-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AuraButton } from "@/components/aura/AuraButton";
import { useAura } from "@/components/aura/useAura";
import { useTabBarInset } from "@/components/tabbar/tabBarInset";
import { auraStatusAccent } from "@/constants/aura";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import type { HomeStop } from "@/features/home/types";
import { DestinationSearch } from "@/features/trips/components/DestinationSearch";
import { TripFormSheet } from "@/features/trips/components/TripForm";
import { geocodeDestination } from "@/features/trips/services/geocoding";
import { useLocalization } from "@/localization";
import { successNotification } from "@/utils/haptics";
import { Globe } from "./aura/globe/Globe";

const SPIN_MS = 1400;

/**
 * Home before any trip: the live globe with "Where to first?". Picking a place spins the globe to
 * it and drops a pin, then the trip sheet slides up with that destination filled in.
 */
export function EmptyHome({ tripCount, onViewTrips }: { tripCount: number; onViewTrips: () => void }) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const tabBarInset = useTabBarInset();
  const { width } = useWindowDimensions();
  const [picked, setPicked] = useState<HomeStop | null>(null);
  const [sheetFor, setSheetFor] = useState<string[] | null>(null);
  const [globeTouched, setGlobeTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globe = useGlobeContext(picked ?? undefined);
  const globeHeight = Math.round(width * 0.78);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const choose = async (destination: string) => {
    const coords = await geocodeDestination(destination);
    if (coords) {
      setPicked({ name: destination, ...coords });
      successNotification();
      timer.current = setTimeout(() => setSheetFor([destination]), SPIN_MS);
    } else {
      setSheetFor([destination]);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={!globeTouched}
          contentContainerStyle={{ paddingBottom: tabBarInset + 24 }}
        >
          <PostHogMaskView style={{ height: globeHeight + insets.top + 8 }}>
            <Animated.View entering={FadeIn.duration(600)}>
              <Globe
                stops={picked ? [picked] : []}
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
                overview
              />
            </Animated.View>
            <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.globeFade} />
          </PostHogMaskView>

          <Animated.View entering={FadeInDown.delay(250).duration(420)} style={styles.body}>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>{t("trip.createTitle")}</Text>
            <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{t("trip.createBody")}</Text>
            <DestinationSearch large selected={picked ? [picked.name] : []} onSelect={(destination) => void choose(destination)} />
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
        </ScrollView>
      </KeyboardAvoidingView>

      <TripFormSheet
        visible={sheetFor !== null}
        initialDestinations={sheetFor ?? undefined}
        onClose={() => {
          setSheetFor(null);
          setPicked(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  globeFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 72 },
  body: { paddingHorizontal: 20, gap: 12, marginTop: -8 },
  title: { fontSize: 34, letterSpacing: -1.2, lineHeight: 38 },
  lede: { fontSize: 15, lineHeight: 22, marginBottom: 6 },
  existing: { alignSelf: "flex-start", marginTop: 4 },
});
