import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Animated, {
  FadeInRight,
  FadeInLeft,
} from "react-native-reanimated";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsStore } from "@/features/settings";
import { NomadButton } from "@/components/nomad/Button";
import { Icon } from "@/components/nomad/Icon";
import { WelcomeStep } from "@/features/onboarding/components/WelcomeStep";
import { SafetyStep } from "@/features/onboarding/components/SafetyStep";
import { LedgerStep } from "@/features/onboarding/components/LedgerStep";
import { AIStep } from "@/features/onboarding/components/AIStep";
import { SecureStep } from "@/features/onboarding/components/SecureStep";
import { ReadyStep } from "@/features/onboarding/components/ReadyStep";
import { useBiometricPresentation, useAuthStore } from "@/features/auth";
import { useModelDownload } from "@/features/ai";
import { useLocalization } from "@/localization";

const STEP_IDS = ["welcome", "safety", "ledger", "ai", "secure", "ready"] as const;

// The four numbered setup steps shown with a "Step X of N" eyebrow.
// Welcome (intro) and Ready (summary) are not numbered.
const NUMBERED_TOTAL = 4;

export default function OnboardingWelcomeScreen() {
  const router = useRouter();
  const { t } = useLocalization();
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const persistedStep = useSettingsStore((s) => s.onboardingStep);
  const setOnboardingStep = useSettingsStore((s) => s.setOnboardingStep);
  const { isDark, nomad } = useTheme();
  const theme = nomad.colors;
  const biometric = useBiometricPresentation();
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const aiDownload = useModelDownload();
  const aiDownloading =
    aiDownload.status === "downloading" || aiDownload.status === "paused";
  const steps = STEP_IDS.map((id) => ({
    id,
    label: id === "secure" ? biometric.name : t(`onboarding.steps.${id === "safety" ? "safetyNet" : id === "ai" ? "onDeviceAi" : id}`),
  }));

  const [step, setStep] = useState(() =>
    Math.min(Math.max(persistedStep, 0), STEP_IDS.length - 1),
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  const [safetyReady, setSafetyReady] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const last = step === steps.length - 1;

  // Persist progress so a killed/relaunched session resumes where it left off.
  useEffect(() => {
    setOnboardingStep(step);
  }, [step, setOnboardingStep]);

  const onDone = () => {
    setOnboardingCompleted(true);
    router.replace("/(auth)/sign-in");
  };

  const canProceed = () => {
    if (step === 1) return safetyReady;
    if (step === 3) return aiReady;
    // Step 4 (backup PIN) is always actionable — its CTA opens the PIN screen.
    return true;
  };

  const next = () => {
    setDirection(1);
    if (last) {
      onDone();
    } else {
      if (!canProceed()) return;
      setStep((s) => s + 1);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  const handleCta = () => {
    // On the security step, route to the PIN setup screen unless a PIN already
    // exists. SetupPin returns to the next onboarding step (Ready) when done.
    if (step === 4 && !isPinSet) {
      router.push("/(auth)/setup-pin?from=onboarding");
      return;
    }
    next();
  };

  const back = () => {
    if (step === 0) return;
    setDirection(-1);
    setStep((s) => s - 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const entering = direction > 0 ? FadeInRight.duration(420) : FadeInLeft.duration(420);

  const renderStep = () => {
    switch (step) {
      case 0:
        return <WelcomeStep theme={theme} />;
      case 1:
        return (
          <SafetyStep
            theme={theme}
            dark={isDark}
            totalSteps={NUMBERED_TOTAL}
            onPermissionsReady={setSafetyReady}
          />
        );
      case 2:
        return <LedgerStep theme={theme} totalSteps={NUMBERED_TOTAL} />;
      case 3:
        return <AIStep theme={theme} totalSteps={NUMBERED_TOTAL} onModelReady={setAiReady} />;
      case 4:
        return <SecureStep theme={theme} totalSteps={NUMBERED_TOTAL} biometric={biometric} />;
      default:
        return (
          <ReadyStep
            theme={theme}
            selectedContactsCount={3}
            biometric={biometric}
          />
        );
    }
  };

  const ctaLabel =
    step === 0
      ? t("onboarding.beginSetup")
      : step === 1
        ? t("onboarding.enableSafetyNet", { count: safetyReady ? 3 : 0 })
        : step === 2
          ? t("common.continue")
          :       step === 3
            ? aiReady
              ? aiDownloading
                ? t("onboarding.continueDownloadBg")
                : t("common.continue")
              : t("onboarding.selectModel")
            : step === 4
              ? isPinSet ? t("common.continue") : t("onboarding.setBackupPin")
              : t("onboarding.startMyTrip");

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        {/* Top bar: back + progress + skip */}
        <View style={styles.topBar}>
          <Pressable
            onPress={back}
            disabled={step === 0}
            style={[
              styles.backBtn,
              {
                backgroundColor: step === 0 ? "transparent" : theme.paperSoft,
                borderColor: step === 0 ? "transparent" : theme.hairline,
                opacity: step === 0 ? 0.3 : 1,
              },
            ]}
          >
            <Icon name="chevronLeft" size={16} color={theme.inkSoft} />
          </Pressable>

          <View style={styles.progressRow}>
            {steps.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: i <= step ? theme.inkDeep : theme.hairline,
                  },
                ]}
              />
            ))}
          </View>

          {/* Onboarding is mandatory — no skip. Spacer keeps the bar balanced. */}
          <View style={{ width: 34 }} />
        </View>

        {/* Content */}
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={step} entering={entering}>
            {renderStep()}
          </Animated.View>
        </ScrollView>

        {/* Bottom CTA */}
        <View pointerEvents="box-none" style={styles.ctaWrap}>
          <LinearGradient
            colors={["transparent", theme.paper]}
            locations={[0, 0.28]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.ctaInner}>
            <NomadButton
              theme={theme}
              full
              variant={last ? "teal" : "primary"}
              onPress={handleCta}
              disabled={!canProceed()}
              icon={
                last ? (
                  <Icon name="check" size={18} color={theme.inverse} strokeWidth={2.4} />
                ) : null
              }
            >
              {ctaLabel}
            </NomadButton>
            <Text style={[styles.ctaHint, { color: theme.inkMuted }]}>
              {t("common.encryptedFooter")}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  progressRow: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  progressBar: {
    flex: 1,
    height: 3,
    borderRadius: 999,
  },
  ctaWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  ctaInner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: Platform.OS === "ios" ? 38 : 24,
  },
  ctaHint: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    marginTop: 10,
    letterSpacing: 0.3,
  },
});
