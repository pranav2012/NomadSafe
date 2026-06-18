import React, { useState, useRef } from "react";
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
import { useSettingsStore } from "@/stores/settingsStore";
import { NomadButton } from "@/components/nomad/Button";
import { Icon } from "@/components/nomad/Icon";
import { WelcomeStep } from "@/components/nomad/onboarding/WelcomeStep";
import { SafetyStep } from "@/components/nomad/onboarding/SafetyStep";
import { LedgerStep } from "@/components/nomad/onboarding/LedgerStep";
import { AIStep } from "@/components/nomad/onboarding/AIStep";
import { SecureStep } from "@/components/nomad/onboarding/SecureStep";
import { ReadyStep } from "@/components/nomad/onboarding/ReadyStep";
import { useBiometricPresentation } from "@/hooks/useBiometricPresentation";
import { useLocalization } from "@/localization";

const STEP_IDS = ["welcome", "safety", "ledger", "ai", "secure", "ready"] as const;

export default function OnboardingWelcomeScreen() {
  const router = useRouter();
  const { t } = useLocalization();
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const { isDark, nomad } = useTheme();
  const theme = nomad.colors;
  const biometric = useBiometricPresentation();
  const steps = STEP_IDS.map((id) => ({
    id,
    label: id === "secure" ? biometric.name : t(`onboarding.steps.${id === "safety" ? "safetyNet" : id === "ai" ? "onDeviceAi" : id}`),
  }));

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [selectedContacts, setSelectedContacts] = useState<number[]>([0, 1]);
  const scrollRef = useRef<ScrollView>(null);

  const last = step === steps.length - 1;

  const onDone = () => {
    setOnboardingCompleted(true);
    router.replace("/(auth)/sign-in");
  };

  const next = () => {
    setDirection(1);
    if (last) {
      onDone();
    } else {
      setStep((s) => s + 1);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
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
            totalSteps={steps.length}
            selectedContacts={selectedContacts}
            setSelectedContacts={setSelectedContacts}
          />
        );
      case 2:
        return <LedgerStep theme={theme} totalSteps={steps.length} />;
      case 3:
        return <AIStep theme={theme} totalSteps={steps.length} />;
      case 4:
        return <SecureStep theme={theme} totalSteps={steps.length} biometric={biometric} />;
      default:
        return (
          <ReadyStep
            theme={theme}
            selectedContactsCount={selectedContacts.length}
            biometric={biometric}
          />
        );
    }
  };

  const ctaLabel =
    step === 0
      ? t("onboarding.beginSetup")
      : step === 1
        ? t("onboarding.enableSafetyNet", { count: selectedContacts.length })
        : step === 2
          ? t("common.continue")
          : step === 3
            ? t("onboarding.downloadModel")
            : step === 4
              ? biometric.setupLabel
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

          {!last ? (
            <Pressable onPress={onDone}>
              <Text style={[styles.skip, { color: theme.inkSoft }]}>{t("onboarding.skip")}</Text>
            </Pressable>
          ) : (
            <View style={{ width: 34 }} />
          )}
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
              onPress={next}
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
  skip: {
    fontSize: 12,
    fontWeight: "500",
    fontFamily: NOMAD_FONTS.uiMedium,
    paddingVertical: 4,
    paddingHorizontal: 6,
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
