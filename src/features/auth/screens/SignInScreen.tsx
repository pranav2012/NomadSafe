import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { AuraSkyHero, SKY_INTRO_MS, consumeSkyIntro } from "@/components/aura/AuraSkyHero";
import { useAura } from "@/components/aura/useAura";
import { PressableScale } from "@/components/motion/PressableScale";
import { Icon } from "@/components/nomad/Icon";
import { LEGAL_URLS } from "@/constants/legal";
import { authClient, useAuthStore } from "@/features/auth";
import { useAmbientLoop } from "@/features/auth/hooks/useAmbientLoop";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { useLocalization } from "@/localization";
import { track } from "@/services/analytics";

const DANGER = "#FF4D5E";
const AMBIENCE = require("../../../../assets/audio/aurora-ambience.m4a");

function GoogleGlyph() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path
        fill="#4285F4"
        d="M17.6 9.2c0-.6-.05-1.18-.16-1.74H9v3.3h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.64-3.88 2.64-6.54z"
      />
      <Path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18z"
      />
      <Path
        fill="#FBBC05"
        d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.82.95 4.05l3.02-2.33z"
      />
      <Path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.98 8.98 0 0 0 9 0 9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </Svg>
  );
}

export default function SignInScreen() {
  const router = useRouter();
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { isSignedIn, isPinSet, setUnlocked } = useAuthStore();
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intro] = useState(consumeSkyIntro);
  const contentDelay = intro ? SKY_INTRO_MS - 900 : 200;
  const soundOn = useSettingsStore((s) => s.ambientSoundEnabled);
  const setSoundOn = useSettingsStore((s) => s.setAmbientSoundEnabled);
  useAmbientLoop(AMBIENCE, soundOn, intro ? SKY_INTRO_MS + 1500 : 3000);

  const heroHeight = Math.round(height * 0.74);

  // Once the session listener confirms we are signed in, route forward: first-time setup, then the app.
  useEffect(() => {
    if (!isSignedIn) return;
    if (!onboardingCompleted) {
      router.replace("/(onboarding)/welcome");
    } else if (!isPinSet) {
      router.replace("/(auth)/setup-pin");
    } else {
      setUnlocked(true);
      router.replace("/(tabs)");
    }
  }, [isSignedIn, isPinSet, onboardingCompleted, router, setUnlocked]);

  const handleGoogleSignIn = async () => {
    if (loading) return;
    setError(null);
    try {
      setLoading("google");
      track("sign_in_started");
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "nomadsafe://",
      });
      if (result?.error) {
        track("sign_in_failed");
        setError(t("auth.signInFailed"));
      }
      // Navigation is handled by the useEffect above once session syncs.
    } catch {
      track("sign_in_failed");
      setError(t("auth.signInFailed"));
    } finally {
      setLoading(null);
    }
  };

  const busy = loading === "google";

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <StatusBar style="light" />

      <View style={{ height: heroHeight }}>
        <Animated.View entering={FadeIn.duration(intro ? 300 : 900)}>
          <AuraSkyHero width={width} height={heroHeight} topInset={insets.top} isDark={isDark} intro={intro} />
        </Animated.View>
        <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={[styles.heroFade, { height: heroHeight * 0.16 }]} />
        <Animated.View
          entering={FadeIn.delay(contentDelay).duration(600)}
          accessible
          accessibilityLabel={`${t("auth.sceneTitle")}, ${t("auth.sceneLocation")}`}
          style={[styles.caption, { top: insets.top + 8 }]}
        >
          <Icon name="mapPin" size={14} color="rgba(255,255,255,0.85)" />
          <View>
            <Text style={[styles.captionTitle, { fontFamily: f.semibold }]}>{t("auth.sceneTitle")}</Text>
            <Text style={[styles.captionPlace, { fontFamily: f.regular }]}>{t("auth.sceneLocation")}</Text>
          </View>
        </Animated.View>
        <Animated.View entering={FadeIn.delay(contentDelay).duration(600)} style={[styles.sound, { top: insets.top + 8 }]}>
          <PressableScale
            onPress={() => setSoundOn(!soundOn)}
            hitSlop={10}
            accessibilityRole="switch"
            accessibilityLabel={t("auth.ambientSound")}
            accessibilityState={{ checked: soundOn }}
            style={styles.soundButton}
          >
            <Icon name={soundOn ? "volume" : "volumeOff"} size={18} color="rgba(255,255,255,0.9)" />
          </PressableScale>
        </Animated.View>
      </View>

      <View style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View entering={FadeInDown.delay(contentDelay).duration(600)}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.bold }]}>{t("common.appName")}</Text>
          <Text style={[styles.tagline, { color: c.textSoft, fontFamily: f.regular }]}>{t("auth.tagline")}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(contentDelay + 180).duration(600)} style={styles.actions}>
          <PressableScale
            onPress={handleGoogleSignIn}
            disabled={busy}
            pressedScale={0.97}
            accessibilityRole="button"
            accessibilityLabel={t("auth.continueWithGoogle")}
            accessibilityState={{ busy, disabled: busy }}
            style={[styles.google, { backgroundColor: c.inverse }]}
          >
            {busy ? (
              <ActivityIndicator color={c.onInverse} />
            ) : (
              <View style={styles.googleMark}>
                <GoogleGlyph />
              </View>
            )}
            <Text style={[styles.googleLabel, { color: c.onInverse, fontFamily: f.semibold }]}>
              {busy ? t("auth.connecting") : t("auth.continueWithGoogle")}
            </Text>
          </PressableScale>

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: DANGER, fontFamily: f.medium }]}>
              {error}
            </Text>
          ) : null}

          <Text style={[styles.legal, { color: c.textMuted, fontFamily: f.regular }]}>
            {t("auth.legalPrefix")}{" "}
            <Text
              accessibilityRole="link"
              style={[styles.legalLink, { color: c.textSoft, fontFamily: f.medium }]}
              onPress={() => Linking.openURL(LEGAL_URLS.privacy)}
            >
              {t("auth.privacyPolicy")}
            </Text>
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heroFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  caption: {
    position: "absolute",
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 40,
    paddingLeft: 12,
    paddingRight: 14,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
  },
  captionTitle: { color: "rgba(255,255,255,0.95)", fontSize: 12, lineHeight: 15 },
  captionPlace: { color: "rgba(255,255,255,0.65)", fontSize: 11, lineHeight: 14 },
  sound: { position: "absolute", right: 16 },
  soundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.22)",
  },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between", marginTop: -24 },
  title: { fontSize: 40, letterSpacing: -1.6, lineHeight: 44 },
  tagline: { fontSize: 16, lineHeight: 23, marginTop: 8, maxWidth: 340 },
  actions: { gap: 14 },
  google: {
    height: 56,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 22,
  },
  googleMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  googleLabel: { fontSize: 16 },
  error: { fontSize: 13, lineHeight: 18, textAlign: "center" },
  legal: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  legalLink: { textDecorationLine: "underline" },
});
