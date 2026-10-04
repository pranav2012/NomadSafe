import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeOut, LinearTransition, ZoomIn } from "react-native-reanimated";
import { PrivateView } from "@/modules/analytics";
import { AuraOrb, type AuraOrbMode, Icon, PressableScale, showAlert, useAura } from "@/atoms";
import {
  localAuth,
  secureStorage,
  useAuthStore,
  useBiometricPresentation,
} from "@/features/auth";
import { BiometricGlyph } from "@/features/auth/components/BiometricGlyph";
import { PinDots } from "@/features/auth/components/PinDots";
import { PinPad } from "@/features/auth/components/PinPad";
import { hashPin, isLegacyPinHash, verifyPin } from "@/features/auth/utils/crypto";
import { pinAttempts } from "@/features/auth/services/pinAttempts";
import { flushBeforeSignOut } from "@/features/auth/services/session";
import { wipeAllDeviceData } from "@/features/settings/services/wipeService";
import { errorNotification, successNotification } from "@/utils/haptics";
import { useLocalization } from "@/localization";

const PIN_LENGTH = 6;
const DANGER = "#FF4D5E";
const SUCCESS = "#3DDC97";

type Phase = "idle" | "scanning" | "success";

export default function LockScreen() {
  const router = useRouter();
  const { c, f, isDark } = useAura();
  const { t, formatDuration } = useLocalization();
  const { width, height } = useWindowDimensions();
  const { user, biometricEnabled, setUnlocked, setPinSet } = useAuthStore();
  const biometric = useBiometricPresentation();

  const [mode, setMode] = useState<"biometric" | "passcode">(
    biometricEnabled ? "biometric" : "passcode",
  );
  const [phase, setPhase] = useState<Phase>("idle");

  const [pin, setPinState] = useState("");
  // Live value so rapid taps between renders never drop a digit.
  const pinRef = useRef("");
  const setPin = useCallback((value: string) => {
    pinRef.current = value;
    setPinState(value);
  }, []);
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  const name = user?.name ?? t("auth.welcomeBack");
  const initial = user?.name?.trim()?.[0]?.toUpperCase() ?? "N";

  const compact = height < 720;
  const passcode = mode === "passcode";
  const orbSize = Math.round(Math.min(width * 0.62, passcode ? (compact ? 112 : 148) : 248));
  const orbMode: AuraOrbMode = phase === "success" ? "done" : phase === "scanning" ? "listening" : "idle";
  const label =
    phase === "idle" ? t("auth.tapToUnlock") : phase === "scanning" ? t("auth.scanning") : biometric.matchedLabel;

  useEffect(() => {
    if (phase !== "scanning") return;
    const id = setInterval(() => setPulse((p) => (p === 0 ? 1 : 0)), 520);
    return () => clearInterval(id);
  }, [phase]);

  const handleUnlock = useCallback(() => {
    pinAttempts.reset();
    setUnlocked(true);
  }, [setUnlocked]);

  // The lock screen is an overlay: hardware back must never reveal the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const applyLockout = useCallback((remainingMs: number) => {
    setIsLocked(true);
    setError(t("auth.lockedFor", { duration: formatDuration(Math.ceil(remainingMs / 1000)) }));
    const timer = setTimeout(() => {
      setIsLocked(false);
      setError("");
    }, remainingMs);
    return () => clearTimeout(timer);
  }, [formatDuration, t]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    pinAttempts.status().then(({ remainingMs }) => {
      if (remainingMs > 0) cleanup = applyLockout(remainingMs);
    });
    return () => cleanup?.();
  }, [applyLockout]);

  const runScan = useCallback(async () => {
    if (phase !== "idle") return;
    setPhase("scanning");

    let success = false;
    try {
      success = await localAuth.authenticateWithBiometric({
        promptMessage: t("auth.nativeUnlockPrompt"),
        cancelLabel: t("auth.nativeCancelLabel"),
      });
    } catch {
      setMode("passcode");
      setError(t("auth.biometricError"));
    }

    if (success) {
      setPhase("success");
      successNotification();
      setTimeout(handleUnlock, 600);
    } else {
      setPhase("idle");
    }
  }, [phase, handleUnlock, t]);

  useEffect(() => {
    if (mode !== "biometric" || !biometricEnabled) return;
    const timer = setTimeout(runScan, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, biometricEnabled]);

  const handleDelete = () => {
    if (isLocked || verifying) return;
    setPin(pinRef.current.slice(0, -1));
    setError("");
  };

  const handleDigit = async (key: string) => {
    if (isLocked || verifying) return;
    if (pinRef.current.length >= PIN_LENGTH) return;

    const next = pinRef.current + key;
    setPin(next);

    if (next.length === PIN_LENGTH) {
      setVerifying(true);
      try {
        const lock = await pinAttempts.status();
        if (lock.remainingMs > 0) {
          applyLockout(lock.remainingMs);
          setPin("");
          return;
        }
        const storedHash = await secureStorage.getPin();
        if (!storedHash) {
          // PIN missing from the keystore (e.g. restored device): force re-auth.
          setPinSet(false);
          showAlert(t("auth.pinMissingTitle"), t("auth.pinMissingBody"), [
            { text: t("common.ok"), onPress: () => void eraseAfterSync() },
          ]);
          return;
        }
        if (await verifyPin(next, storedHash)) {
          if (isLegacyPinHash(storedHash)) {
            secureStorage.setPin(await hashPin(next)).catch(() => {});
          }
          handleUnlock();
          return;
        }
        errorNotification();
        setShakeKey((k) => k + 1);
        const result = await pinAttempts.recordFailure();
        if (result.lockMs > 0) {
          applyLockout(result.lockMs);
        } else {
          setError(t("auth.attemptsRemaining", { count: result.attemptsLeft }));
        }
        setTimeout(() => setPin(""), 300);
      } catch {
        setError(t("auth.biometricError"));
        setPin("");
      } finally {
        setVerifying(false);
      }
    }
  };

  // Without the PIN the owner can't be verified, so leaving the lock screen erases this phone's data.
  async function eraseNow() {
    setSigningOut(true);
    try {
      await wipeAllDeviceData({ keepModels: true });
      router.replace("/(auth)/sign-in");
    } finally {
      setSigningOut(false);
    }
  }

  // Same check as Settings: unsynced changes would be lost with the rest of the data.
  async function eraseAfterSync() {
    if (signingOut) return;
    setSigningOut(true);
    let synced = false;
    try {
      synced = await flushBeforeSignOut();
    } finally {
      setSigningOut(false);
    }
    if (synced) {
      await eraseNow();
      return;
    }
    showAlert(t("settings.signOutUnsyncedTitle"), t("settings.signOutUnsyncedBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("auth.eraseConfirm"), style: "destructive", onPress: () => void eraseNow() },
    ]);
  }

  function handleForgotPin() {
    if (signingOut) return;
    showAlert(t("auth.eraseTitle"), t("auth.eraseBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("auth.eraseConfirm"), style: "destructive", onPress: () => void eraseAfterSync() },
    ]);
  }

  const toggleMode = () => {
    setMode((m) => (m === "biometric" ? "passcode" : "biometric"));
    setError("");
    setPin("");
  };

  const avatarSize = Math.round(orbSize * 0.42);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <Animated.View layout={LinearTransition.springify().damping(20)} style={[styles.identity, { paddingTop: compact ? 8 : 28 }]}>
          <PressableScale
            onPress={mode === "biometric" ? runScan : undefined}
            disabled={mode !== "biometric" || phase !== "idle"}
            pressedScale={0.95}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityElementsHidden={mode !== "biometric"}
            importantForAccessibility={mode === "biometric" ? "auto" : "no-hide-descendants"}
            style={{ width: orbSize, height: orbSize }}
          >
            <AuraOrb size={orbSize} mode={orbMode} level={phase === "scanning" ? (pulse ? 7 : 2) : 0} isDark={isDark} core={false} />
            <View style={styles.center} pointerEvents="none">
              {phase === "success" ? (
                <Animated.View
                  key="ok"
                  entering={ZoomIn.springify().damping(14)}
                  style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: SUCCESS }]}
                >
                  <Icon name="check" size={avatarSize * 0.45} color="#0B0D12" strokeWidth={2.8} />
                </Animated.View>
              ) : (
                <PrivateView>
                  <Animated.View
                    key="initial"
                    entering={FadeIn.duration(240)}
                    style={[
                      styles.avatar,
                      {
                        width: avatarSize,
                        height: avatarSize,
                        borderRadius: avatarSize / 2,
                        backgroundColor: isDark ? "rgba(11,13,18,0.42)" : "rgba(255,255,255,0.7)",
                        borderColor: isDark ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.95)",
                      },
                    ]}
                  >
                    <Text style={[styles.initial, { color: c.text, fontFamily: f.semibold, fontSize: avatarSize * 0.44 }]}>{initial}</Text>
                  </Animated.View>
                </PrivateView>
              )}
            </View>
          </PressableScale>

          <PrivateView>
            <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{name}</Text>
          </PrivateView>
          <View style={styles.statusRow}>
            <Icon name="lock" size={12} color={c.textMuted} strokeWidth={2.2} />
            <Text style={[styles.status, { color: c.textMuted, fontFamily: f.medium }]}>{t("auth.locked")}</Text>
          </View>
        </Animated.View>

        {mode === "biometric" ? (
          <Animated.View key="bio" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.bioWrap}>
            <PressableScale
              onPress={runScan}
              disabled={phase !== "idle"}
              accessibilityRole="button"
              accessibilityLabel={t("auth.useBiometric", { biometricName: biometric.name })}
              style={[styles.bioButton, { backgroundColor: c.surfaceStrong, borderColor: phase === "success" ? SUCCESS : c.hairline }]}
            >
              <BiometricGlyph kind={biometric.kind} size={38} color={phase === "success" ? SUCCESS : c.text} />
            </PressableScale>
            <Text style={[styles.bioLabel, { color: phase === "success" ? SUCCESS : c.textSoft, fontFamily: f.medium }]}>{label}</Text>
          </Animated.View>
        ) : (
          <Animated.View key="pass" entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.passWrap}>
            <PinDots length={PIN_LENGTH} filled={pin.length} shakeKey={shakeKey} error={!!error && pin.length === PIN_LENGTH} />
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
              disabled={isLocked}
              keySize={compact ? 66 : 76}
              leftAction={
                biometricEnabled ? (
                  <PressableScale
                    onPress={runScan}
                    disabled={phase !== "idle"}
                    accessibilityRole="button"
                    accessibilityLabel={t("auth.useBiometric", { biometricName: biometric.name })}
                    style={styles.leftAction}
                  >
                    <BiometricGlyph kind={biometric.kind} size={30} color={c.textSoft} />
                  </PressableScale>
                ) : undefined
              }
            />
          </Animated.View>
        )}

        <View style={styles.footer}>
          {biometricEnabled ? (
            <PressableScale onPress={toggleMode} accessibilityRole="button" style={styles.footerHit}>
              <Text style={[styles.footerAction, { color: c.textSoft, fontFamily: f.semibold }]}>
                {mode === "biometric"
                  ? t("auth.usePasscodeInstead")
                  : t("auth.useBiometric", { biometricName: biometric.name })}
              </Text>
            </PressableScale>
          ) : null}
          <PressableScale onPress={handleForgotPin} disabled={signingOut} accessibilityRole="button" style={styles.footerHit}>
            <Text style={[styles.footerAction, { color: c.textMuted, fontFamily: f.semibold }]}>{t("auth.forgotPin")}</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, alignItems: "center" },
  identity: { alignItems: "center" },
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  avatar: { alignItems: "center", justifyContent: "center", borderWidth: 1 },
  initial: { letterSpacing: -0.5 },
  name: { fontSize: 22, letterSpacing: -0.5, marginTop: 6, maxWidth: 280, textAlign: "center" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  status: { fontSize: 13 },
  bioWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  bioButton: {
    width: 76,
    height: 76,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  bioLabel: { fontSize: 14 },
  passWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 13, textAlign: "center", minHeight: 18, marginTop: 14, marginBottom: 18, paddingHorizontal: 24 },
  leftAction: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center" },
  footer: { flexDirection: "row", gap: 8, alignItems: "center", paddingBottom: 8 },
  footerHit: { paddingHorizontal: 12, paddingVertical: 10 },
  footerAction: { fontSize: 14 },
});
