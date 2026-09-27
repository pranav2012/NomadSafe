import React, { useCallback, useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  BackHandler,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, {
  FadeInRight,
  FadeInLeft,
} from "react-native-reanimated";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { LEGAL_URLS } from "@/constants/legal";
import { useTheme } from "@/hooks/useTheme";
import { useSettingsStore } from "@/features/settings";
import { NomadButton } from "@/components/nomad/Button";
import { Icon } from "@/components/nomad/Icon";
import { WelcomeStep } from "@/features/onboarding/components/WelcomeStep";
import { SafetyStep, type ContactsSummary } from "@/features/onboarding/components/SafetyStep";
import { LedgerStep } from "@/features/onboarding/components/LedgerStep";
import { AIStep, type AiSetupStatus } from "@/features/onboarding/components/AIStep";
import { SecureStep } from "@/features/onboarding/components/SecureStep";
import { ReadyStep } from "@/features/onboarding/components/ReadyStep";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { useBiometricPresentation, useAuthStore } from "@/features/auth";
import { isValidPhone } from "@/features/safety/utils/phone";
import { useLocalization } from "@/localization";

const STEP_IDS = ["welcome", "safety", "ledger", "ai", "secure", "ready"] as const;

// The four numbered setup steps shown with a "Step X of N" eyebrow.
// Welcome (intro) and Ready (summary) are not numbered.
const NUMBERED_TOTAL = 4;

const clampStep = (value: number) => Math.min(Math.max(value, 0), STEP_IDS.length - 1);

function readContactsSummary(): ContactsSummary {
  const contacts = emergencyContactsStorage.get();
  return {
    count: contacts.length,
    withPhone: contacts.filter((c) => isValidPhone(c.phone)).length,
  };
}

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

  const [step, setStep] = useState(() => clampStep(persistedStep));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [contacts, setContacts] = useState<ContactsSummary>(readContactsSummary);
  const [aiStatus, setAiStatus] = useState<AiSetupStatus>("checking");
  const scrollRef = useRef<ScrollView>(null);

  const last = step === STEP_IDS.length - 1;

  // Persist progress so a killed/relaunched session resumes where it left off.
  useEffect(() => {
    setOnboardingStep(step);
  }, [step, setOnboardingStep]);

  // SetupPin writes the next step to the store; pick it up when we regain focus.
  useFocusEffect(
    useCallback(() => {
      setDirection(1);
      setStep(clampStep(useSettingsStore.getState().onboardingStep));
    }, []),
  );

  // Android hardware back walks to the previous step instead of leaving onboarding.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || step === 0) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        setDirection(-1);
        setStep((s) => Math.max(s - 1, 0));
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        return true;
      });
      return () => sub.remove();
    }, [step]),
  );

  const onDone = () => {
    setOnboardingCompleted(true);
    router.replace("/(auth)/sign-in");
  };

  const advance = () => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, STEP_IDS.length - 1));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  // Contacts are optional, but SOS can't text anyone without a phone number.
  const confirmSafetyContinue = () => {
    if (contacts.withPhone > 0) {
      advance();
      return;
    }
    Alert.alert(
      t("onboarding.noContactsTitle"),
      contacts.count === 0
        ? t("onboarding.noContactsWarning")
        : t("emergencyContacts.noneWithPhone"),
      [
        { text: t("onboarding.addContactAction"), style: "cancel" },
        { text: t("onboarding.skipForNow"), onPress: advance },
      ],
    );
  };

  const handleCta = () => {
    if (last) {
      onDone();
      return;
    }
    if (step === 1) {
      confirmSafetyContinue();
      return;
    }
    // On the security step, route to the PIN setup screen unless a PIN already
    // exists. SetupPin returns to the next onboarding step (Ready) when done.
    if (step === 4 && !isPinSet) {
      router.push("/(auth)/setup-pin?from=onboarding");
      return;
    }
    advance();
  };

  const back = () => {
    if (step === 0) return;
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const openPrivacyPolicy = () => {
    Linking.openURL(LEGAL_URLS.privacy).catch(() => {});
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
            onContactsChange={setContacts}
          />
        );
      case 2:
        return <LedgerStep theme={theme} totalSteps={NUMBERED_TOTAL} />;
      case 3:
        return <AIStep theme={theme} totalSteps={NUMBERED_TOTAL} onStatusChange={setAiStatus} />;
      case 4:
        return <SecureStep theme={theme} totalSteps={NUMBERED_TOTAL} biometric={biometric} />;
      default:
        return <ReadyStep theme={theme} biometric={biometric} />;
    }
  };

  const aiCtaLabel = () => {
    if (aiStatus === "downloading") return t("onboarding.continueDownloadBg");
    if (aiStatus === "downloaded" || aiStatus === "unsupported") return t("common.continue");
    return t("onboarding.skipForNow");
  };

  const ctaLabel =
    step === 0
      ? t("onboarding.beginSetup")
      : step === 1
        ? contacts.count > 0
          ? t("onboarding.enableSafetyNet", { count: contacts.count })
          : t("onboarding.skipForNow")
        : step === 2
          ? t("common.continue")
          : step === 3
            ? aiCtaLabel()
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
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            accessibilityState={{ disabled: step === 0 }}
            hitSlop={8}
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

          <View
            style={styles.progressRow}
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: NUMBERED_TOTAL, now: Math.min(step, NUMBERED_TOTAL) }}
          >
            {/* One segment per numbered step, so it matches "Step X of N". */}
            {Array.from({ length: NUMBERED_TOTAL }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: i < step ? theme.inkDeep : theme.hairline,
                  },
                ]}
              />
            ))}
          </View>

          {/* Spacer keeps the progress bar centred. */}
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
              icon={
                last ? (
                  <Icon name="check" size={18} color={theme.inverse} strokeWidth={2.4} />
                ) : null
              }
            >
              {ctaLabel}
            </NomadButton>
            <View style={styles.footerRow}>
              <Text style={[styles.ctaHint, { color: theme.inkMuted }]}>
                {t("onboarding.footerLocal")}
              </Text>
              <Pressable
                onPress={openPrivacyPolicy}
                accessibilityRole="link"
                hitSlop={8}
              >
                <Text style={[styles.ctaHint, styles.link, { color: theme.inkSoft }]}>
                  {t("onboarding.privacyPolicy")}
                </Text>
              </Pressable>
            </View>
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
    start: 0,
    end: 0,
    bottom: 0,
  },
  ctaInner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: Platform.OS === "ios" ? 38 : 24,
  },
  footerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    columnGap: 8,
    marginTop: 10,
  },
  ctaHint: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    letterSpacing: 0.3,
  },
  link: {
    textDecorationLine: "underline",
  },
});
