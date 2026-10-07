import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, {
  FadeInLeft,
  FadeInRight,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from "react-native-reanimated";
import { AuraButton, Icon, PressableScale, showAlert, springs, useAura } from "@/atoms";
import { LEGAL_URLS, openLegalPage } from "@/constants/legal";
import { aiRuntime, useProvisioningStore } from "@/modules/ai";
import { useSettingsStore } from "@/features/settings";
import { useCircle } from "@/features/location-sharing/hooks/useCircle";
import { ONBOARDING_STEPS, type OnboardingStepId } from "@/features/onboarding/steps";
import { SafetyStep } from "@/features/onboarding/components/SafetyStep";
import { OnDeviceStep } from "@/features/onboarding/components/OnDeviceStep";
import { useLocalization } from "@/localization";
import { track } from "@/modules/analytics";

const LAST_STEP = ONBOARDING_STEPS.length - 1;
const TOTAL = ONBOARDING_STEPS.length;
const BACKGROUND_PHASES = new Set(["queued", "downloading", "verifying", "waitingForWifi"]);

/** Maps a persisted step into range; indices past the end come from older, longer flows. */
function clampStep(value: number) {
  return Math.min(Math.max(0, value), LAST_STEP);
}

export default function OnboardingWelcomeScreen() {
  const router = useRouter();
  const { t, isRTL } = useLocalization();
  const { c, f, isDark, accent } = useAura();
  const insets = useSafeAreaInsets();
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const persistedStep = useSettingsStore((s) => s.onboardingStep);
  const setOnboardingStep = useSettingsStore((s) => s.setOnboardingStep);
  const aiPhase = useProvisioningStore((s) => s.phase);

  const [step, setStep] = useState(() => clampStep(persistedStep));
  const [direction, setDirection] = useState<1 | -1>(1);
  const circle = useCircle();
  const scrollRef = useRef<ScrollView>(null);
  // Segments count steps from 1, so the current step's segment is already filled.
  const progress = useSharedValue(step + 1);

  const stepId: OnboardingStepId = ONBOARDING_STEPS[step];
  const last = step === LAST_STEP;

  // Start the model download as early as possible; onboarding never waits on it.
  useEffect(() => {
    void aiRuntime.ensureProvisioned();
  }, []);

  useEffect(() => {
    setOnboardingStep(step);
    progress.set(withSpring(step + 1, springs.snappy));
  }, [step, setOnboardingStep, progress]);

  const goTo = useCallback((next: number, dir: 1 | -1) => {
    setDirection(dir);
    setStep(Math.min(Math.max(next, 0), LAST_STEP));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // Android hardware back walks to the previous step instead of leaving onboarding.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || step === 0) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        goTo(step - 1, -1);
        return true;
      });
      return () => sub.remove();
    }, [step, goTo]),
  );

  const advance = () => goTo(step + 1, 1);
  const back = () => goTo(step - 1, -1);

  // Onboarding runs after sign-in, so finishing it opens the app.
  const onDone = () => {
    setOnboardingCompleted(true);
    track("onboarding_completed");
    router.replace("/(tabs)");
  };

  const confirmSafetyContinue = () => {
    if (!circle.loaded || circle.people.length > 0) {
      advance();
      return;
    }
    showAlert(
      t("onboarding.noCircleTitle"),
      t("onboarding.noCircleWarning"),
      [
        { text: t("onboarding.addContactAction"), style: "cancel" },
        { text: t("onboarding.skipForNow"), onPress: advance },
      ],
    );
  };

  const handleCta = () => {
    switch (stepId) {
      case "safety":
        confirmSafetyContinue();
        return;
      default:
        if (last) onDone();
        else advance();
    }
  };

  const ctaLabel = (() => {
    switch (stepId) {
      case "safety":
        return circle.people.length > 0 ? t("common.continue") : t("onboarding.skipForNow");
      case "onDevice":
        if (BACKGROUND_PHASES.has(aiPhase)) return t("onboarding.continueInBackground");
        return last ? t("onboarding.startMyTrip") : t("common.continue");
    }
  })();

  const openPrivacyPolicy = () => {
    openLegalPage(LEGAL_URLS.privacy);
  };

  const forward = direction > 0 !== isRTL;
  const entering = (forward ? FadeInRight : FadeInLeft).springify().damping(22).stiffness(220).reduceMotion(ReduceMotion.System);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />

      <ScrollView
        ref={scrollRef}
        style={styles.root}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 58, paddingBottom: insets.bottom + 170 }}
      >
        <Animated.View key={step} entering={entering}>
          {stepId === "safety" ? <SafetyStep /> : <OnDeviceStep />}
        </Animated.View>
      </ScrollView>

      <View pointerEvents="box-none" style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <LinearGradient pointerEvents="none" colors={[c.bg, `${c.bg}00`]} locations={[0.55, 1]} style={StyleSheet.absoluteFill} />
        <PressableScale
          onPress={back}
          disabled={step === 0}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
          accessibilityState={{ disabled: step === 0 }}
          hitSlop={8}
          style={[styles.backBtn, { backgroundColor: c.surfaceStrong, opacity: step === 0 ? 0 : 1 }]}
        >
          <Icon name="chevronLeft" size={17} color={c.text} />
        </PressableScale>
        <View
          style={styles.progressRow}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("onboarding.progressA11y", { step: step + 1, total: TOTAL })}
          accessibilityValue={{ min: 1, max: TOTAL, now: step + 1 }}
        >
          {Array.from({ length: TOTAL }, (_, index) => (
            <ProgressSegment key={index} index={index} progress={progress} track={c.surfaceStrong} fill={accent} />
          ))}
        </View>
        <View style={styles.backBtn} />
      </View>

      <View pointerEvents="box-none" style={styles.ctaWrap}>
        <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} locations={[0, 0.3]} style={StyleSheet.absoluteFill} />
        <View style={[styles.ctaInner, { paddingBottom: insets.bottom + 14 }]}>
          <AuraButton label={ctaLabel} onPress={handleCta} icon={last ? "check" : undefined} />
          <View style={styles.footerRow}>
            <Icon name="lock" size={12} color={c.textMuted} />
            <Text style={[styles.hint, { color: c.textMuted, fontFamily: f.regular }]}>{t("onboarding.footerLocal")}</Text>
            <Pressable onPress={openPrivacyPolicy} accessibilityRole="link" hitSlop={8}>
              <Text style={[styles.hint, styles.link, { color: c.textSoft, fontFamily: f.medium }]}>{t("onboarding.privacyPolicy")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

/** One progress segment; fills as the animated step value passes its index. */
function ProgressSegment({ index, progress, track, fill }: { index: number; progress: SharedValue<number>; track: string; fill: string }) {
  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.min(1, Math.max(0, progress.get() - index)) * 100}%`,
  }));
  return (
    <View style={[styles.segment, { backgroundColor: track }]}>
      <Animated.View style={[styles.segmentFill, { backgroundColor: fill }, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  progressRow: { flex: 1, flexDirection: "row", gap: 6 },
  segment: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  segmentFill: { height: "100%", borderRadius: 2 },
  ctaWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  ctaInner: { paddingHorizontal: 20, paddingTop: 30 },
  footerRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 12 },
  hint: { fontSize: 12, textAlign: "center" },
  link: { textDecorationLine: "underline" },
});
