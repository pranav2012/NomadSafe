import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { NOMAD_FONTS, type NomadTheme } from "@/constants/nomadTokens";
import { useTheme } from "@/hooks/useTheme";
import { authClient, useAuthStore } from "@/features/auth";
import { Stamp } from "@/components/nomad/Stamp";
import { useLocalization } from "@/localization";
import { LEGAL_URLS } from "@/constants/legal";
import { BRAND_NAVY, NomadLogo } from "@/components/brand/NomadLogo";
import { track } from "@/services/analytics";

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

interface SocialButtonProps {
  theme: NomadTheme;
  glyph: React.ReactNode;
  label: string;
  bg: string;
  fg: string;
  border: string;
  onPress: () => void;
}

function SocialButton({ theme, glyph, label, bg, fg, border, onPress }: SocialButtonProps) {
  void theme;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.social,
        { backgroundColor: bg, borderColor: border, transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      {glyph}
      <Text style={[styles.socialLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export default function SignInScreen() {
  const router = useRouter();
  const { isDark, nomad } = useTheme();
  const { t } = useLocalization();
  const theme = nomad.colors;
  const { isSignedIn, isPinSet, setUnlocked } = useAuthStore();

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        {/* Hero */}
        <View style={styles.hero}>
          <LinearGradient
            colors={[theme.stampSoft, theme.paper]}
            locations={[0, 0.65]}
            start={{ x: 0.6, y: 0.3 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Svg
            width="100%"
            height="100%"
            viewBox="0 0 390 200"
            preserveAspectRatio="none"
            style={[StyleSheet.absoluteFill, { opacity: 0.22 }]}
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <Path
                key={i}
                d={`M-20,${24 + i * 22} Q120,${12 + i * 20} 220,${28 + i * 22} T420,${32 + i * 21}`}
                fill="none"
                stroke={theme.inkMuted}
                strokeWidth="0.6"
                strokeDasharray={i % 3 === 0 ? "0" : "2 3"}
              />
            ))}
          </Svg>

          <View style={[styles.stampSEA]}>
            <Stamp label="SEA" sub="MAR 2025" color={theme.teal} rot={-12} size={84} />
          </View>
          <View style={[styles.stampLIS]}>
            <Stamp label="LIS" sub="JUL 2024" color={theme.mustard} rot={13} size={72} />
          </View>

          <View
            style={[
              styles.shieldMark,
              { backgroundColor: BRAND_NAVY, shadowColor: theme.shadow },
            ]}
          >
            <NomadLogo size={60} tile={false} />
          </View>
        </View>

        {/* Content */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.eyebrow, { color: theme.stamp }]}>{t("auth.welcome")}</Text>
          <Text style={[styles.headline, { color: theme.inkDeep }]}>
            {t("auth.continueTo")}{" "}
            <Text style={[styles.headlineItalic, { color: theme.stamp }]}>
              {t("common.appName")}
            </Text>
            .
          </Text>

          {/* Social */}
          <View style={styles.socialGroup}>
            <SocialButton
              theme={theme}
              glyph={<GoogleGlyph />}
              label={loading === "google" ? t("auth.connecting") : t("auth.continueWithGoogle")}
              bg={theme.paperSoft}
              fg={theme.inkDeep}
              border={theme.hairline}
              onPress={handleGoogleSignIn}
            />
          </View>

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: theme.stamp }]}>
              {error}
            </Text>
          ) : null}

          <Text style={[styles.footer, { color: theme.inkMuted }]}>
            {t("auth.legalPrefix")}{" "}
            <Text
              accessibilityRole="link"
              style={styles.footerLink}
              onPress={() => Linking.openURL(LEGAL_URLS.privacy)}
            >
              {t("auth.privacyPolicy")}
            </Text>
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 200,
    overflow: "hidden",
    position: "relative",
  },
  stampSEA: { position: "absolute", left: 32, top: 44 },
  stampLIS: { position: "absolute", right: 36, top: 58 },
  shieldMark: {
    position: "absolute",
    left: "50%",
    bottom: 16,
    marginLeft: -32,
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  content: {
    paddingHorizontal: 26,
    paddingTop: 20,
    paddingBottom: 40,
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1.8,
    fontWeight: "700",
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  headline: {
    fontFamily: NOMAD_FONTS.display,
    fontWeight: "500",
    fontSize: 38,
    lineHeight: 38 * 1.02,
    marginTop: 6,
    letterSpacing: 0,
  },
  headlineItalic: {
    fontFamily: NOMAD_FONTS.displayItalic,
    fontStyle: "italic",
  },
  socialGroup: {
    flexDirection: "column",
    gap: 10,
    marginTop: 24,
  },
  social: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
  },
  socialLabel: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontWeight: "600",
    fontSize: 15,
    letterSpacing: 0,
  },
  error: {
    fontFamily: NOMAD_FONTS.uiSemi,
    fontSize: 13,
    marginTop: 14,
    textAlign: "center",
  },
  footerLink: { textDecorationLine: "underline" },
  footer: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    marginTop: 22,
    letterSpacing: 0.3,
    lineHeight: 11 * 1.6,
  },
});
