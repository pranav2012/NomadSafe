import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, BackHandler, Alert } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Svg, { Circle, Path, Line } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import { NOMAD_FONTS } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import {
  localAuth,
  secureStorage,
  useAuthStore,
  useBiometricPresentation,
} from "@/features/auth";
import { hashPin, isLegacyPinHash, verifyPin } from "@/features/auth/utils/crypto";
import { pinAttempts } from "@/features/auth/services/pinAttempts";
import { signOutAndCleanup } from "@/services/session";
import { lightImpact, errorNotification } from "@/utils/haptics";
import { Icon } from "@/components/nomad/Icon";
import { useLocalization } from "@/localization";

const PIN_LENGTH = 6;
const NUMPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "delete"];
const GLYPH = 168;

type Phase = "idle" | "scanning" | "success";

export default function LockScreen() {
  const router = useRouter();
  const { isDark, nomad } = useTheme();
  const { t, formatDuration } = useLocalization();
  const theme = nomad.colors;
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
  const [isLocked, setIsLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const scanY = useSharedValue(0);
  const successScale = useSharedValue(0);
  const shakeX = useSharedValue(0);

  const name = user?.name ?? t("auth.welcomeBack");
  const initial = user?.name?.trim()?.[0]?.toUpperCase() ?? "N";

  const accent = phase === "success" ? theme.teal : theme.mustard;
  const label =
    phase === "idle" ? t("auth.tapToUnlock") : phase === "scanning" ? t("auth.scanning") : biometric.matchedLabel;

  const scanStyle = useAnimatedStyle(() => ({ transform: [{ translateY: scanY.value }] }));
  const successStyle = useAnimatedStyle(() => ({
    opacity: successScale.value,
    transform: [{ scale: successScale.value }],
  }));
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

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
    scanY.set(-GLYPH * 0.3);
    scanY.set(withRepeat(
      withSequence(
        withTiming(GLYPH * 0.3, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(-GLYPH * 0.3, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
    ));

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
    cancelAnimation(scanY);

    if (success) {
      setPhase("success");
      successScale.set(withTiming(1, { duration: 320 }));
      setTimeout(handleUnlock, 600);
    } else {
      setPhase("idle");
    }
  }, [phase, scanY, successScale, handleUnlock, t]);

  useEffect(() => {
    if (mode !== "biometric" || !biometricEnabled) return;
    const t = setTimeout(runScan, 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, biometricEnabled]);

  const shake = useCallback(() => {
    shakeX.set(withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    ));
  }, [shakeX]);

  const handleKeyPress = async (key: string) => {
    if (isLocked || verifying || key === "") return;
    if (key === "delete") {
      setPin(pinRef.current.slice(0, -1));
      setError("");
      return;
    }
    lightImpact();
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
          Alert.alert(t("auth.pinMissingTitle"), t("auth.pinMissingBody"), [
            { text: t("common.ok"), onPress: handleSignOut },
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
        shake();
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

  async function handleSignOut() {
    await signOutAndCleanup();
    router.replace("/(auth)/sign-in");
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <LinearGradient
        colors={[theme.paper, theme.paperDeep]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        {/* Identity */}
        <View style={styles.identity}>
          <LinearGradient
            colors={[theme.mustard, theme.stamp]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.avatar, { shadowColor: theme.stamp }]}
          >
            <Text style={[styles.avatarText, { color: theme.inverse }]}>{initial}</Text>
          </LinearGradient>
          <Text style={[styles.name, { color: theme.inkDeep }]}>{name}</Text>
          <Text style={[styles.locked, { color: theme.inkMuted }]}>
            {t("auth.vaultLocked")}
          </Text>
        </View>

        {mode === "biometric" ? (
          <View style={styles.faceWrap}>
            <Pressable onPress={runScan} disabled={phase !== "idle"}>
              <LinearGradient
                colors={[theme.inkDeep, isDark ? "#2A332E" : "#2A332E"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.glyph, { shadowColor: theme.shadow }]}
              >
                {/* corner brackets */}
                {(["tl", "tr", "bl", "br"] as const).map((pos) => (
                  <View
                    key={pos}
                    style={[
                      styles.bracket,
                      bracketStyle(pos, accent),
                    ]}
                  />
                ))}

                <BiometricGlyph type={biometric.kind} color={theme.paperSoft} />

                {phase === "scanning" && (
                  <Animated.View
                    style={[styles.scanLine, scanStyle]}
                  >
                    <LinearGradient
                      colors={["transparent", theme.mustard, "transparent"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>
                )}

                {phase === "success" && (
                  <Animated.View style={[styles.successWrap, successStyle]}>
                    <View style={[styles.successCircle, { backgroundColor: theme.teal, shadowColor: theme.teal }]}>
                      <Icon name="check" size={30} color={theme.inverse} strokeWidth={2.6} />
                    </View>
                  </Animated.View>
                )}
              </LinearGradient>
            </Pressable>

            <Text style={[styles.faceLabel, { color: phase === "success" ? theme.teal : theme.inkSoft }]}>
              {label}
            </Text>
          </View>
        ) : (
          <View style={styles.passWrap}>
            <Animated.View style={[styles.dotsRow, shakeStyle]}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    { backgroundColor: i < pin.length ? theme.inkDeep : theme.hairline },
                  ]}
                />
              ))}
            </Animated.View>

            {error ? (
              <Text style={[styles.error, { color: theme.stamp }]}>{error}</Text>
            ) : (
              <View style={{ height: 18 }} />
            )}

            <View style={styles.numpad}>
              {NUMPAD.map((key, i) => (
                <Pressable
                  key={i}
                  onPress={() => handleKeyPress(key)}
                  accessibilityRole="button"
                  accessibilityLabel={key === "delete" ? t("auth.deleteDigit") : key || undefined}
                  accessibilityElementsHidden={key === ""}
                  importantForAccessibility={key === "" ? "no-hide-descendants" : "auto"}
                  disabled={key === "" || isLocked}
                  style={[
                    styles.numKey,
                    {
                      backgroundColor: key === "" ? "transparent" : theme.paperSoft,
                      borderColor: key === "" ? "transparent" : theme.hairline,
                      opacity: isLocked ? 0.4 : 1,
                    },
                  ]}
                >
                  {key === "delete" ? (
                    <Icon name="chevronLeft" size={22} color={theme.inkDeep} />
                  ) : (
                    <Text style={[styles.numKeyText, { color: theme.inkDeep }]}>{key}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Footer actions */}
        <View style={styles.footer}>
          {biometricEnabled && (
            <Pressable
              onPress={() => {
                setMode((m) => (m === "biometric" ? "passcode" : "biometric"));
                setError("");
                setPin("");
              }}
            >
              <Text style={[styles.footerAction, { color: theme.inkSoft }]}>
                {mode === "biometric"
                  ? t("auth.usePasscodeInstead")
                  : t("auth.useBiometric", { biometricName: biometric.name })}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={handleSignOut}>
            <Text style={[styles.footerAction, { color: theme.stamp }]}>
              {t("auth.signOut")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

function BiometricGlyph({ type, color }: { type: "face" | "fingerprint" | "generic"; color: string }) {
  if (type === "fingerprint") {
    return (
      <Svg width="100%" height="100%" viewBox="0 0 168 168" style={StyleSheet.absoluteFill}>
        <Path d="M56 82c0-16 12-28 28-28s28 12 28 28" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <Path d="M48 78c2-22 18-38 36-38 20 0 36 16 36 38" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.82" />
        <Path d="M64 88c0-12 8-20 20-20s20 8 20 20c0 22-8 34-21 44" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <Path d="M80 86c0-4 2-6 4-6s4 2 4 6c0 20-8 31-22 38" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <Path d="M104 112c4-8 6-17 6-26" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.82" />
        <Path d="M60 108c-3-6-4-13-4-22" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.82" />
      </Svg>
    );
  }

  return (
    <Svg width="100%" height="100%" viewBox="0 0 168 168" style={StyleSheet.absoluteFill}>
      <Circle cx="66" cy="74" r="3.4" fill={color} />
      <Circle cx="102" cy="74" r="3.4" fill={color} />
      <Path
        d="M66,108 Q84,118 102,108"
        fill="none"
        stroke={color}
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      <Line
        x1="84"
        y1="80"
        x2="84"
        y2="96"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
      />
    </Svg>
  );
}

function bracketStyle(pos: "tl" | "tr" | "bl" | "br", accent: string) {
  const base = { borderColor: accent } as const;
  switch (pos) {
    case "tl":
      return { ...base, top: 20, left: 20, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderTopLeftRadius: 7 };
    case "tr":
      return { ...base, top: 20, right: 20, borderTopWidth: 2.5, borderRightWidth: 2.5, borderTopRightRadius: 7 };
    case "bl":
      return { ...base, bottom: 20, left: 20, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderBottomLeftRadius: 7 };
    case "br":
      return { ...base, bottom: 20, right: 20, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderBottomRightRadius: 7 };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, alignItems: "center", paddingTop: 24 },
  identity: { alignItems: "center" },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  avatarText: {
    fontFamily: NOMAD_FONTS.displayItalic,
    fontStyle: "italic",
    fontWeight: "500",
    fontSize: 28,
  },
  name: {
    fontFamily: NOMAD_FONTS.display,
    fontWeight: "500",
    fontSize: 22,
    marginTop: 12,
    letterSpacing: 0,
  },
  locked: {
    fontSize: 11,
    letterSpacing: 1.6,
    fontWeight: "700",
    fontFamily: NOMAD_FONTS.monoMedium,
    marginTop: 4,
  },
  faceWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  glyph: {
    width: GLYPH,
    height: GLYPH,
    borderRadius: 38,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.18,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  bracket: { position: "absolute", width: 26, height: 26 },
  scanLine: {
    position: "absolute",
    left: 20,
    right: 20,
    height: 2.5,
    borderRadius: 2,
  },
  successWrap: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  successCircle: {
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  faceLabel: {
    marginTop: 22,
    fontSize: 14,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontWeight: "600",
  },
  passWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  dotsRow: { flexDirection: "row", gap: 16, marginBottom: 8 },
  dot: { width: 14, height: 14, borderRadius: 999 },
  error: {
    fontSize: 13,
    textAlign: "center",
    fontFamily: NOMAD_FONTS.uiMedium,
    marginTop: 10,
    height: 18,
  },
  numpad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    width: 280,
    marginTop: 28,
    gap: 16,
  },
  numKey: {
    width: 72,
    height: 72,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  numKeyText: {
    fontSize: 26,
    fontFamily: NOMAD_FONTS.display,
    fontWeight: "500",
  },
  footer: {
    flexDirection: "row",
    gap: 28,
    alignItems: "center",
    paddingVertical: 12,
  },
  footerAction: {
    fontSize: 13,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontWeight: "600",
  },
});
