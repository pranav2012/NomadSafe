import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useAura } from "@/components/aura/useAura";
import { PressableScale } from "@/components/motion/PressableScale";
import { auraStatusAccent } from "@/constants/aura";
import { LEGAL_URLS } from "@/constants/legal";
import { authClient, useAuthStore } from "@/features/auth";
import { Globe } from "@/features/home/components/aura/globe/Globe";
import { useLocalization } from "@/localization";
import { track } from "@/services/analytics";

const DANGER = "#FF4D5E";

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

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const globeHeight = Math.round(Math.min(width * 1.05, height * 0.56)) + insets.top;

  // Once the session listener confirms we are signed in, route forward.
  useEffect(() => {
    if (!isSignedIn) return;
    if (!isPinSet) {
      router.replace("/(auth)/setup-pin");
    } else {
      setUnlocked(true);
      router.replace("/(tabs)");
    }
  }, [isSignedIn, isPinSet, router, setUnlocked]);

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
      <StatusBar style={isDark ? "light" : "dark"} />

      <View style={{ height: globeHeight }}>
        <Animated.View entering={FadeIn.duration(900)}>
          <Globe
            stops={[]}
            focusIndex={0}
            width={width}
            height={globeHeight}
            topInset={insets.top}
            contacts={[]}
            contactColor="#3DDC97"
            accent={auraStatusAccent.calm}
            isDark={isDark}
            overview
          />
        </Animated.View>
        <LinearGradient pointerEvents="none" colors={[`${c.bg}00`, c.bg]} style={styles.globeFade} />
      </View>

      <View style={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View entering={FadeInDown.delay(200).duration(480)}>
          <Text style={[styles.title, { color: c.text, fontFamily: f.bold }]}>{t("common.appName")}</Text>
          <Text style={[styles.tagline, { color: c.textSoft, fontFamily: f.regular }]}>{t("auth.tagline")}</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(340).duration(480)} style={styles.actions}>
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
  globeFade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 96 },
  body: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between", marginTop: -12 },
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
