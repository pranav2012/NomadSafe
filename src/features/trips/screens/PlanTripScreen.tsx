import React, { useEffect, useState } from "react";
import { BackHandler, Keyboard, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { PrivateView } from "@/modules/analytics";
import { AuraButton, AuraChip, Icon, PressableScale, useAura } from "@/atoms";
import { auraHitSlop, auraSignal, auraStatusAccent } from "@/constants/aura";
import { Globe } from "@/features/home/components/aura/globe/Globe";
import { useGlobeContext } from "@/features/home/hooks/useGlobeContext";
import type { HomeStop } from "@/features/home/types";
import { DestinationSearch } from "@/features/trips/components/DestinationSearch";
import { PlannedTripForm } from "@/features/trips/components/PlannedTripForm";
import { TripForm } from "@/features/trips/components/TripForm";
import { normalizeSearchText } from "@/features/trips/data/destinations";
import { geocodeDestination, type LatLng } from "@/features/trips/services/geocoding";
import { useTripsStore } from "@/features/trips/store/tripsStore";
import { canCreateTrip, usePlanStore } from "@/modules/billing";
import { useLocalization } from "@/localization";
import { selectionChanged, successNotification } from "@/utils/haptics";

type Step = "cities" | "details";

/**
 * New trip in two steps under a live globe: pick cities (pinned and joined by arcs), then the details.
 * Without dates (or a place) it becomes a planned trip; `confirm` turns a planned trip into a real one,
 * and `plannedOnly` is for free users at the trip limit, who can still start planning.
 */
export default function PlanTripScreen() {
  const router = useRouter();
  const { fromGroup, plannedOnly, confirm } = useLocalSearchParams<{ fromGroup?: string; plannedOnly?: string; confirm?: string }>();
  const [confirming] = useState(() => useTripsStore.getState().plannedTrips.find((planned) => planned.id === confirm));
  const onlyPlanned = plannedOnly === "1";
  const [planned, setPlanned] = useState(onlyPlanned);
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isFirstTrip = useTripsStore((state) => state.trips.length === 0);
  // Checked once on open: saving the new trip must not flip this and bounce to the paywall.
  const [tripAllowed] = useState(() => canCreateTrip(useTripsStore.getState().trips, usePlanStore.getState()));
  const startOnDetails = Boolean(confirming && confirming.destinations.length > 0);
  const [step, setStep] = useState<Step>(startOnDetails ? "details" : "cities");
  const [detailsMounted, setDetailsMounted] = useState(startOnDetails);
  const [destinations, setDestinations] = useState<string[]>(() => confirming?.destinations ?? []);
  const [coordinates, setCoordinates] = useState<ReadonlyMap<string, LatLng | null>>(
    () => new Map(confirming?.destinations.map((name, i) => [name, confirming.destinationCoordinates?.[i] ?? null] as const) ?? []),
  );

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

  useEffect(() => {
    if (!tripAllowed && !onlyPlanned) router.replace({ pathname: "/paywall", params: { reason: "trips" } });
  }, [onlyPlanned, router, tripAllowed]);

  const goToCities = () => {
    Keyboard.dismiss();
    if (!onlyPlanned) setPlanned(false);
    setStep("cities");
  };

  useEffect(() => {
    if (step !== "details") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      Keyboard.dismiss();
      if (!onlyPlanned) setPlanned(false);
      setStep("cities");
      return true;
    });
    return () => sub.remove();
  }, [onlyPlanned, step]);

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

  const planWithoutPlace = () => {
    setPlanned(true);
    goToDetails();
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.View style={[styles.band, bandStyle]}>
        <PrivateView style={styles.flex}>
          <Animated.View style={canvasStyle}>
            <Globe
              stops={stops}
              focusIndex={Math.max(0, stops.length - 1)}
              width={width}
              height={canvasHeight}
              topInset={insets.top}
              origin={globe.origin}
              contacts={[]}
              contactColor={auraSignal.ready}
              accent={auraStatusAccent.calm}
              isDark={isDark}
              overview={stops.length === 0}
              showRoute
              labelStops
              fitHeight={keyboardOpen ? compactBand : step === "cities" ? fullBand : detailsBand}
            />
          </Animated.View>
        </PrivateView>
        <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.bandFade} />
        <View style={[styles.topBar, { top: insets.top + 8 }]}>
          <PressableScale
            onPress={step === "details" ? goToCities : () => router.back()}
            accessibilityRole="button"
            accessibilityLabel={step === "details" ? t("common.back") : t("common.close")}
            hitSlop={auraHitSlop(36)}
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
                  {confirming ? t("planned.confirmTitle", { name: confirming.name }) : isFirstTrip ? t("trip.createTitle") : t("trip.planNextTitle")}
                </Text>
                <Text style={[styles.lede, { color: c.textSoft, fontFamily: f.regular }]}>{confirming ? t("planned.confirmBody") : t("trip.planBody")}</Text>
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
            {!confirming && destinations.length === 0 && !keyboardOpen ? (
              <AuraButton label={t("planned.justName")} variant="ghost" size="md" onPress={planWithoutPlace} style={styles.justName} />
            ) : null}
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
            <Text style={[styles.panelTitle, { color: c.text, fontFamily: f.semibold }]}>
              {planned ? t("planned.formTitle") : confirming ? t("planned.confirmTitle", { name: confirming.name }) : t("trip.planDetailsTitle")}
            </Text>
            {destinations.length > 0 ? (
              <PressableScale onPress={goToCities} hitSlop={8} accessibilityRole="button" style={styles.route}>
                <Text numberOfLines={1} style={[styles.routeText, { color: c.textSoft, fontFamily: f.regular }]}>
                  {destinations.join(" → ")}
                </Text>
                <Icon name="chevronRight" size={12} color={c.textMuted} />
              </PressableScale>
            ) : null}
          </View>
          {planned ? (
            <PlannedTripForm destinations={destinations} knownCoordinates={coordinates} atTripLimit={onlyPlanned} onSaved={() => router.back()} />
          ) : (
            <TripForm
              destinations={destinations}
              knownCoordinates={coordinates}
              fromGroupId={fromGroup}
              plannedTrip={confirming}
              onNotSureOfDates={confirming || fromGroup ? undefined : () => setPlanned(true)}
              onSave={() => router.back()}
            />
          )}
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
  justName: { alignSelf: "center", marginTop: 4 },
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
