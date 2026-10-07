import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { PrivateView } from "@/modules/analytics";
import { Icon, PressableScale, useAura } from "@/atoms";
import { localAuth, useAuthStore, useBiometricPresentation } from "@/features/auth";
import { BiometricGlyph } from "@/features/auth/components/BiometricGlyph";
import { SecurityRing } from "@/features/auth/components/SecurityRing";
import { errorNotification, successNotification } from "@/utils/haptics";
import { useLocalization } from "@/localization";

const DANGER = "#FF4D5E";
const SUCCESS = "#3DDC97";
const AUTO_PROMPT_DELAY_MS = 650;

type Phase = "idle" | "scanning" | "success";

export default function LockScreen() {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const { width, height } = useWindowDimensions();
  const user = useAuthStore((s) => s.user);
  const setUnlocked = useAuthStore((s) => s.setUnlocked);
  const biometric = useBiometricPresentation();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const busy = useRef(false);

  const name = user?.name ?? t("auth.welcomeBack");
  const initial = user?.name?.trim()?.[0]?.toUpperCase() ?? "N";
  const orbSize = Math.round(Math.min(width * 0.62, height < 720 ? 200 : 248));
  const avatarSize = Math.round(orbSize * 0.42);
  const label = phase === "scanning" ? t("auth.scanning") : phase === "success" ? t("auth.unlocked") : t("auth.tapToUnlock");

  // The lock screen is an overlay: hardware back must never reveal the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("scanning");
    setError("");
    const result = await localAuth.authenticate(t("auth.nativeUnlockPrompt")).catch(() => "failed" as const);
    busy.current = false;

    // With the phone's screen lock removed there is nothing left to check against, so the app lock turns off.
    if (result === "noScreenLock") useAuthStore.getState().setLockEnabled(false);
    if (result === "ok" || result === "noScreenLock") {
      setPhase("success");
      successNotification();
      setTimeout(() => setUnlocked(true), 600);
      return;
    }
    setPhase("idle");
    if (result === "failed") {
      errorNotification();
      setShakeKey((k) => k + 1);
      setError(t("auth.unlockFailed"));
    }
  }, [setUnlocked, t]);

  useEffect(() => {
    const timer = setTimeout(() => void unlock(), AUTO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [unlock]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.identity}>
          <SecurityRing size={orbSize} state={phase} isDark={isDark} errorKey={shakeKey}>
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
          </SecurityRing>

          <PrivateView>
            <Text numberOfLines={1} style={[styles.name, { color: c.text, fontFamily: f.semibold }]}>{name}</Text>
          </PrivateView>
          <View style={styles.statusRow}>
            <Icon name="lock" size={12} color={c.textMuted} strokeWidth={2.2} />
            <Text style={[styles.status, { color: c.textMuted, fontFamily: f.medium }]}>{t("auth.locked")}</Text>
          </View>
        </View>

        <View style={styles.bioWrap}>
          <PressableScale
            onPress={() => void unlock()}
            disabled={phase !== "idle"}
            accessibilityRole="button"
            accessibilityLabel={t("auth.unlockWith", { biometricName: biometric.name })}
            style={[styles.bioButton, { backgroundColor: c.surfaceStrong, borderColor: phase === "success" ? SUCCESS : c.hairline }]}
          >
            <BiometricGlyph kind={biometric.kind} size={38} color={phase === "success" ? SUCCESS : c.text} />
          </PressableScale>
          <Text style={[styles.bioLabel, { color: phase === "success" ? SUCCESS : c.textSoft, fontFamily: f.medium }]}>{label}</Text>
          <Text
            accessibilityRole={error ? "alert" : undefined}
            accessibilityLiveRegion="polite"
            style={[styles.error, { color: DANGER, fontFamily: f.medium }]}
          >
            {error}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, alignItems: "center" },
  identity: { alignItems: "center", paddingTop: 28 },
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
  error: { fontSize: 13, textAlign: "center", minHeight: 18, paddingHorizontal: 24 },
});
