import React, { useEffect, useState } from "react";
import { BackHandler, Keyboard, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  KeyboardState,
  LinearTransition,
  interpolate,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { LinearGradient } from "expo-linear-gradient";
import { PostHogMaskView } from "posthog-react-native";
import { Icon } from "@/components/nomad/Icon";
import { PressableScale } from "@/components/motion/PressableScale";
import { AuraButton } from "@/components/aura/AuraButton";
import { AuraChip } from "@/components/aura/AuraChip";
import { useAura } from "@/components/aura/useAura";
import { auraStatusAccent } from "@/constants/aura";
import { Globe } from "@/features/home/components/aura/globe/Globe";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import type { HomeStop } from "@/features/home/types";
import { DestinationSearch } from "@/features/trips/components/DestinationSearch";
import { TripForm } from "@/features/trips/components/TripForm";
import { normalizeSearchText } from "@/features/trips/data/destinations";
import { geocodeDestination, type LatLng } from "@/features/trips/services/geocoding";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { useLocalization } from "@/localization";
import { selectionChanged, successNotification } from "@/utils/haptics";

type Step = "cities" | "details";

/** New trip in two steps under a live globe: pick cities (pinned and joined by arcs), then the details. */
export default function PlanTripScreen() {
  const router = useRouter();
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isFirstTrip = useTripsStore((state) => state.trips.length === 0);
  const [step, setStep] = useState<Step>("cities");
  const [detailsMounted, setDetailsMounted] = useState(false);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [coordinates, setCoordinates] = useState<ReadonlyMap<string, LatLng | null>>(new Map());

  const stops: HomeStop[] = destinations.flatMap((name) => {
    const coords = coordinates.get(name);
    return coords ? [{ name, ...coords }] : [];
  });
  const focus = stops[stops.length - 1];
  const globe = useGlobeContext(focus);

  // The canvas keeps its full size and is cropped around its centre as the band shrinks.
  const fullBand = Math.round(Math.min(width * 0.92, height * 0.46));
  const detailsBand = Math.round(height * 0.3);
  const compactBand = Math.round(height * 0.18);
  const canvasHeight = insets.top + fullBand;

  const keyboard = useAnimatedKeyboard();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useAnimatedReaction(
    () => keyboard.state.get() === KeyboardState.OPENING || keyboard.state.get() === KeyboardState.OPEN,
    (open, previous) => {
      if (open !== previous) scheduleOnRN(setKeyboardOpen, open);
    },
  );
  const restBand = useSharedValue(fullBand);
  const stepIn = useSharedValue(1);

  useEffect(() => {
    restBand.set(withTiming(step === "cities" ? fullBand : detailsBand, { duration: 320 }));
    stepIn.set(0);
    stepIn.set(withTiming(1, { duration: 280 }));
  }, [detailsBand, fullBand, restBand, step, stepIn]);

  const band = useDerivedValue(() => {
    const open = interpolate(keyboard.height.get(), [0, 220], [0, 1], Extrapolation.CLAMP);
    return restBand.get() + (compactBand - restBand.get()) * open;
  });
  const bandStyle = useAnimatedStyle(() => ({ height: insets.top + band.get() }));
  const canvasStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -(fullBand - band.get()) / 2 }] }));
  const keyboardSpacer = useAnimatedStyle(() => ({ height: Math.max(keyboard.height.get(), insets.bottom) }));
  const stepStyle = useAnimatedStyle(() => ({
    opacity: stepIn.get(),
    transform: [{ translateY: (1 - stepIn.get()) * 24 }],
  }));

  const goToCities = () => {
    Keyboard.dismiss();
    setStep("cities");
  };

  useEffect(() => {
    if (step !== "details") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Keyboard.dismiss();
      setStep("cities");
      return true;
    });
    return () => sub.remove();
  }, [step]);

  const addCity = async (destination: string) => {
    const normalized = normalizeSearchText(destination);
    if (destinations.some((item) => normalizeSearchText(item) === normalized)) return;
    setDestinations((current) => [...current, destination]);
    selectionChanged();

    const coords = await geocodeDestination(destination);
    setCoordinates((current) => new Map(current).set(destination, coords));
    if (coords) successNotification();
  };

  const removeCity = (destination: string) => {
    setDestinations((current) => current.filter((item) => item !== destination));
  };

  const goToDetails = () => {
    Keyboard.dismiss();
    setDetailsMounted(true);
    setStep("details");
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.View style={[styles.band, bandStyle]}>
        <PostHogMaskView style={styles.flex}>
          <Animated.View style={canvasStyle}>
            <Globe
              stops={stops}
              focusIndex={Math.max(0, stops.length - 1)}
              width={width}
              height={canvasHeight}
              topInset={insets.top}
              origin={globe.origin}
              contacts={[]}
              contactColor="#3DDC97"
              accent={auraStatusAccent.calm}
              isDark={isDark}
              overview
            />
          </Animated.View>
        </PostHogMaskView>
        <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.bandFade} />
        <View style={[styles.topBar, { top: insets.top + 8 }]}>
          <PressableScale
            onPress={step === "details" ? goToCities : () => router.back()}
            accessibilityRole="button"
            accessibilityLabel={step === "details" ? t("common.back") : t("common.close")}
            style={[styles.roundButton, { backgroundColor: c.surfaceStrong }]}
          >
            <Icon name={step === "details" ? "chevronLeft" : "x"} size={16} color={c.text} />
          </PressableScale>
        </View>
      </Animated.View>

      {step === "cities" ? (
        <Animated.View style={[styles.flex, stepStyle]}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.citiesScroll}>
            {keyboardOpen ? null : (
              <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.intro}>
                <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
                  {isFirstTrip ? t("trip.createTitle") : t("trip.planNextTitle")}
                </Text>
                <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{t("trip.planBody")}</Text>
              </Animated.View>
            )}
            <DestinationSearch large autoFocus selected={destinations} onSelect={(destination) => void addCity(destination)} />
            {destinations.length > 0 ? (
              <Animated.View layout={LinearTransition.duration(200)} style={styles.chips}>
                {destinations.map((destination) => (
                  <AuraChip key={destination} label={destination} icon="mapPin" onRemove={() => removeCity(destination)} />
                ))}
              </Animated.View>
            ) : null}
          </ScrollView>
          <View style={styles.footer}>
            <AuraButton label={t("common.continue")} icon="chevronRight" disabled={destinations.length === 0} onPress={goToDetails} />
          </View>
        </Animated.View>
      ) : null}

      {detailsMounted ? (
        <Animated.View
          style={[
            styles.panel,
            { backgroundColor: c.card, borderColor: c.hairline },
            step === "details" ? stepStyle : styles.hidden,
          ]}
        >
          <View style={styles.panelHeader}>
            <Text style={[styles.panelTitle, { color: c.text, fontFamily: f.semibold }]}>{t("trip.planDetailsTitle")}</Text>
            <PressableScale onPress={goToCities} hitSlop={8} accessibilityRole="button" style={styles.route}>
              <Text numberOfLines={1} style={[styles.routeText, { color: c.textSoft, fontFamily: f.regular }]}>
                {destinations.join(" → ")}
              </Text>
              <Icon name="chevronRight" size={12} color={c.textMuted} />
            </PressableScale>
          </View>
          <TripForm destinations={destinations} knownCoordinates={coordinates} onSave={() => router.back()} />
        </Animated.View>
      ) : null}

      <Animated.View style={keyboardSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  hidden: { display: "none" },
  band: { overflow: "hidden" },
  bandFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 56 },
  topBar: { position: "absolute", left: 16, right: 16, flexDirection: "row" },
  roundButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  citiesScroll: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16, gap: 12 },
  intro: { gap: 6 },
  title: { fontSize: 30, letterSpacing: -1, lineHeight: 34 },
  lede: { fontSize: 15, lineHeight: 21 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  panel: {
    flex: 1,
    marginTop: -12,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
  },
  panelHeader: { paddingHorizontal: 20, paddingBottom: 6, gap: 2 },
  panelTitle: { fontSize: 22, letterSpacing: -0.5 },
  route: { flexDirection: "row", alignItems: "center", gap: 4 },
  routeText: { fontSize: 13.5, flexShrink: 1 },
});
