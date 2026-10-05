import React, { useRef, useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { AuraButton, Icon, PressableScale, useAura } from "@/atoms";
import {
  localAuth,
  secureStorage,
  useAuthStore,
  useBiometricPresentation,
} from "@/features/auth";
import { BiometricGlyph } from "@/features/auth/components/BiometricGlyph";
import { PinDots } from "@/features/auth/components/PinDots";
import { PinPad } from "@/features/auth/components/PinPad";
import { SecurityRing } from "@/features/auth/components/SecurityRing";
import { checkPin } from "@/features/auth/services/pinVerifier";
import { hashPin } from "@/features/auth/utils/crypto";
import { ONBOARDING_LOCK_STEP } from "@/features/onboarding/steps";
import { useSettingsStore } from "@/features/settings";
import { errorNotification } from "@/utils/haptics";
import { useLocalization } from "@/localization";
import { logger } from "@/modules/logger";

const PIN_LENGTH = 6;
const DANGER = "#FF4D5E";
const BIOMETRIC_CHECK_TIMEOUT_MS = 2000;

export default function SetupPinScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromOnboarding = from === "onboarding";
  const { c, f, isDark } = useAura();
  const { t, formatDuration } = useLocalization();
  const { height } = useWindowDimensions();
  const { setPinSet, setBiometricEnabled, setUnlocked } = useAuthStore();
  const setOnboardingStep = useSettingsStore((s) => s.setOnboardingStep);
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const isPinSet = useAuthStore((s) => s.isPinSet);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const biometric = useBiometricPresentation();

  // Changing an existing PIN starts by confirming the current one.
  const [step, setStep] = useState<"current" | "create" | "confirm">(() => (isPinSet ? "current" : "create"));
  const hadPin = useRef(isPinSet);
  const [oldPin, setOldPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const compact = height < 720;

  // Refs hold the live value so rapid taps between renders never drop a digit.
  const oldRef = useRef("");
  const pinRef = useRef("");
  const confirmRef = useRef("");
  const currentPin = step === "current" ? oldPin : step === "create" ? pin : confirmPin;
  const currentRef = step === "current" ? oldRef : step === "create" ? pinRef : confirmRef;
  const setCurrentPin = (value: string) => {
    currentRef.current = value;
    (step === "current" ? setOldPin : step === "create" ? setPin : setConfirmPin)(value);
  };

  const ownerConfirmed = () => {
    oldRef.current = "";
    setOldPin("");
    setError("");
    setStep("create");
  };

  const lockOut = (remainingMs: number) => {
    setLockedOut(true);
    setError(t("auth.lockedFor", { duration: formatDuration(Math.ceil(remainingMs / 1000)) }));
    setTimeout(() => {
      setLockedOut(false);
      setError("");
    }, remainingMs);
  };

  const verifyCurrent = async (value: string) => {
    setVerifying(true);
    try {
      const result = await checkPin(value);
      // Nothing stored to check against: the app is already unlocked, so a new PIN can be set.
      if (result.status === "ok" || result.status === "missing") {
        ownerConfirmed();
        return;
      }
      if (result.status === "locked") {
        lockOut(result.remainingMs);
      } else {
        errorNotification();
        setShakeKey((k) => k + 1);
        if (result.lockMs > 0) lockOut(result.lockMs);
        else setError(t("auth.attemptsRemaining", { count: result.attemptsLeft }));
      }
      setTimeout(() => {
        oldRef.current = "";
        setOldPin("");
      }, 300);
    } catch (err) {
      logger.warn("auth", "current pin check failed", err);
      setError(t("auth.pinUnavailable"));
      oldRef.current = "";
      setOldPin("");
    } finally {
      setVerifying(false);
    }
  };

  const confirmWithBiometric = async () => {
    try {
      const ok = await localAuth.authenticateWithBiometric({
        promptMessage: t("auth.currentPinTitle"),
        cancelLabel: t("auth.nativeCancelLabel"),
      });
      if (ok) ownerConfirmed();
    } catch {
      setError(t("auth.biometricError"));
    }
  };

  const handleComplete = async (finalPin: string) => {
    setSaved(true);
    const hashed = await hashPin(finalPin);
    await secureStorage.setPin(hashed);
    setPinSet(true);

    // Some devices never settle the biometric availability check, so it can't hold up navigation:
    // turn biometric unlock on in the background once it answers, or give up after a moment.
    // A changed PIN keeps the user's biometric choice.
    if (!hadPin.current) {
      void Promise.race([
        localAuth.checkBiometricAvailability(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), BIOMETRIC_CHECK_TIMEOUT_MS)),
      ])
        .then((result) => {
          if (result?.available) setBiometricEnabled(true);
        })
        .catch(() => {});
    }

    if (fromOnboarding) {
      // Back to onboarding's lock step, which now shows the recap; finishing
      // onboarding unlocks the app.
      setOnboardingStep(ONBOARDING_LOCK_STEP);
      if (router.canGoBack()) router.back();
      else router.replace("/(onboarding)/welcome");
      return;
    }

    setUnlocked(true);
    if (from === "settings" && router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const handleDelete = () => {
    setCurrentPin(currentRef.current.slice(0, -1));
    setError("");
  };

  const handleDigit = (key: string) => {
    if (verifying || lockedOut || currentRef.current.length >= PIN_LENGTH) return;

    const next = currentRef.current + key;
    setCurrentPin(next);
    if (step === "current") setError("");

    if (next.length === PIN_LENGTH) {
      if (step === "current") {
        void verifyCurrent(next);
      } else if (step === "create") {
        setTimeout(() => setStep("confirm"), 280);
      } else if (next === pinRef.current) {
        handleComplete(next).catch((err) => {
          logger.error("auth", "pin setup failed", err);
          setSaved(false);
        });
      } else {
        errorNotification();
        setShakeKey((k) => k + 1);
        setError(t("auth.pinMismatch"));
        setTimeout(() => {
          confirmRef.current = "";
          setConfirmPin("");
          setError("");
        }, 1000);
      }
    }
  };

  const startOver = () => {
    setStep("create");
    pinRef.current = "";
    confirmRef.current = "";
    setPin("");
    setConfirmPin("");
    setError("");
  };

  const orbSize = compact ? 92 : 120;

  // Signing in hides the sign-in screen and Expo Router falls back to this one: onboarding comes
  // first, and an existing PIN is kept (LockGate asks for it).
  if (!from && !onboardingCompleted) return <Redirect href="/(onboarding)/welcome" />;
  if (!from && isPinSet && !saved) return <Redirect href="/(tabs)" />;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.body}>
          <SecurityRing
            size={orbSize}
            state={saved ? "success" : "idle"}
            isDark={isDark}
            progress={saved ? 1 : currentPin.length / PIN_LENGTH}
            errorKey={shakeKey}
          >
            <Icon name={saved ? "check" : "lock"} size={orbSize * 0.24} color={isDark ? "#FFFFFF" : c.text} strokeWidth={2.2} />
          </SecurityRing>

          <Animated.View key={step} entering={FadeInDown.duration(320)} exiting={FadeOut.duration(120)} style={styles.copy}>
            <Text style={[styles.title, { color: c.text, fontFamily: f.semibold }]}>
              {step === "current"
                ? t("auth.currentPinTitle")
                : step === "create"
                  ? t("auth.createPinTitle")
                  : t("auth.confirmPinTitle")}
            </Text>
            <Text style={[styles.sub, { color: c.textSoft, fontFamily: f.regular }]}>
              {step === "current"
                ? t("auth.currentPinSub")
                : step === "create"
                  ? t("auth.createPinSub", { biometricName: biometric.name })
                  : t("auth.confirmPinSub")}
            </Text>
          </Animated.View>

          <View style={styles.dots}>
            <PinDots length={PIN_LENGTH} filled={currentPin.length} shakeKey={shakeKey} error={!!error} />
          </View>
          <Text
            accessibilityRole={error ? "alert" : undefined}
            accessibilityLiveRegion="polite"
            style={[styles.error, { color: DANGER, fontFamily: f.medium }]}
          >
            {error}
          </Text>

          <PinPad
            onDigit={handleDigit}
            onDelete={handleDelete}
            disabled={saved || verifying || lockedOut}
            keySize={compact ? 66 : 76}
            leftAction={
              step === "current" && biometricEnabled ? (
                <PressableScale
                  onPress={() => void confirmWithBiometric()}
                  accessibilityRole="button"
                  accessibilityLabel={t("auth.useBiometric", { biometricName: biometric.name })}
                  style={styles.leftAction}
                >
                  <BiometricGlyph kind={biometric.kind} size={30} color={c.textSoft} />
                </PressableScale>
              ) : undefined
            }
          />

          <View style={styles.footer}>
            {step === "confirm" ? (
              <Animated.View entering={FadeIn.duration(200)}>
                <AuraButton label={t("auth.startOver")} variant="ghost" size="md" onPress={startOver} />
              </Animated.View>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  copy: { alignItems: "center", marginTop: 14 },
  title: { fontSize: 28, letterSpacing: -0.9, lineHeight: 33, textAlign: "center" },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 8, textAlign: "center", maxWidth: 320 },
  dots: { marginTop: 28 },
  error: { fontSize: 13, textAlign: "center", minHeight: 18, marginTop: 12, marginBottom: 18 },
  footer: { height: 44, marginTop: 14, justifyContent: "center" },
  leftAction: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
});
