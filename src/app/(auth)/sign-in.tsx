import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Svg, { Path } from "react-native-svg";
import * as AppleAuthentication from "expo-apple-authentication";
import { NOMAD_FONTS, getNomadTheme, type NomadTheme } from "@/constants/nomadTokens";
import { useThemeContext } from "@/providers/ThemeProvider";
import { useAuthStore } from "@/stores/authStore";
import { authClient } from "@/lib/auth-client";
import { NomadButton } from "@/components/nomad/Button";
import { Icon } from "@/components/nomad/Icon";
import { Stamp } from "@/components/nomad/Stamp";

const DIAL_CODES = ["+44", "+1", "+91", "+61", "+351"];

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

function AppleGlyph() {
  return (
    <Svg width={17} height={20} viewBox="0 0 16 20">
      <Path
        fill="#fff"
        d="M13.1 10.6c0-2.3 1.9-3.4 1.95-3.5-1.06-1.55-2.72-1.77-3.31-1.8-1.41-.14-2.75.83-3.46.83-.71 0-1.81-.81-2.98-.79C3.76 5.37 2.3 6.2 1.5 7.6c-1.64 2.85-.42 7.06 1.18 9.37.78 1.13 1.71 2.4 2.93 2.36 1.17-.05 1.62-.76 3.04-.76s1.82.76 3.06.73c1.26-.02 2.06-1.16 2.83-2.3.89-1.32 1.26-2.6 1.28-2.66-.03-.01-2.45-.94-2.47-3.73zM10.86 3.5c.65-.79 1.08-1.88.96-2.97-.93.04-2.06.62-2.73 1.4-.6.7-1.12 1.81-.98 2.88 1.04.08 2.1-.53 2.75-1.31z"
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
  const { isDark } = useThemeContext();
  const theme = getNomadTheme(isDark);
  const { isPinSet, setSignedIn, setUnlocked } = useAuthStore();

  const [dial, setDial] = useState("+44");
  const [dialOpen, setDialOpen] = useState(false);
  const [num, setNum] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const digits = num.replace(/\D/g, "");
  const ready = digits.length >= 7;

  const handlePostSignIn = () => {
    setSignedIn(true);
    if (!isPinSet) {
      router.replace("/(auth)/setup-pin");
    } else {
      setUnlocked(true);
      router.replace("/(tabs)");
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading("google");
      await authClient.signIn.social({ provider: "google" });
      handlePostSignIn();
    } catch (error) {
      void error;
    } finally {
      setLoading(null);
    }
  };

  const handleAppleSignIn = async () => {
    try {
      setLoading("apple");
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      await authClient.signIn.social({
        provider: "apple",
        idToken: { token: credential.identityToken! },
      });
      handlePostSignIn();
    } catch (error) {
      void error;
    } finally {
      setLoading(null);
    }
  };

  const handlePhoneSendOTP = async () => {
    if (!ready) return;
    const phone = `${dial} ${num.trim()}`;
    try {
      setLoading("phone");
      await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
      router.push({ pathname: "/(auth)/phone-verify", params: { phone } });
    } catch (error) {
      void error;
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
              { backgroundColor: theme.inkDeep, shadowColor: "#1A1612" },
            ]}
          >
            <Icon name="shield" size={30} color={theme.mustard} strokeWidth={2} />
          </View>
        </View>

        {/* Content */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.eyebrow, { color: theme.stamp }]}>Welcome</Text>
          <Text style={[styles.headline, { color: theme.inkDeep }]}>
            Continue to{" "}
            <Text style={[styles.headlineItalic, { color: theme.stamp }]}>
              Nomad Safe
            </Text>
            .
          </Text>

          {/* Social */}
          <View style={styles.socialGroup}>
            <SocialButton
              theme={theme}
              glyph={<GoogleGlyph />}
              label={loading === "google" ? "Connecting…" : "Continue with Google"}
              bg={theme.paperSoft}
              fg={theme.inkDeep}
              border={theme.hairline}
              onPress={handleGoogleSignIn}
            />
            {Platform.OS === "ios" && (
              <SocialButton
                theme={theme}
                glyph={<AppleGlyph />}
                label={loading === "apple" ? "Connecting…" : "Continue with Apple"}
                bg={theme.inkDeep}
                fg="#fff"
                border={theme.inkDeep}
                onPress={handleAppleSignIn}
              />
            )}
          </View>

          {/* Divider */}
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
            <Text style={[styles.dividerLabel, { color: theme.inkMuted }]}>
              or use phone
            </Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.hairline }]} />
          </View>

          {/* Phone input */}
          <View style={styles.phoneRow}>
            <View>
              <Pressable
                onPress={() => setDialOpen((o) => !o)}
                style={[
                  styles.dial,
                  { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                ]}
              >
                <Text style={[styles.dialText, { color: theme.inkDeep }]}>{dial}</Text>
                <Icon name="chevronDown" size={14} color={theme.inkMuted} />
              </Pressable>
              {dialOpen && (
                <View
                  style={[
                    styles.dialMenu,
                    { backgroundColor: theme.paperSoft, borderColor: theme.hairline },
                  ]}
                >
                  {DIAL_CODES.map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => {
                        setDial(d);
                        setDialOpen(false);
                      }}
                      style={styles.dialMenuItem}
                    >
                      <Text
                        style={[
                          styles.dialText,
                          { color: d === dial ? theme.stamp : theme.inkDeep },
                        ]}
                      >
                        {d}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <TextInput
              value={num}
              onChangeText={(v) => setNum(v.replace(/[^0-9]/g, "").slice(0, 11))}
              placeholder="7700 900000"
              placeholderTextColor={theme.inkMuted}
              keyboardType="phone-pad"
              style={[
                styles.phoneInput,
                {
                  backgroundColor: theme.paperSoft,
                  borderColor: theme.hairline,
                  color: theme.inkDeep,
                },
              ]}
            />
          </View>

          <NomadButton
            theme={theme}
            variant="teal"
            full
            onPress={handlePhoneSendOTP}
            style={[styles.sendBtn, { opacity: ready && loading !== "phone" ? 1 : 0.45 }]}
            icon={<Icon name="chevronRight" size={18} color="#fff" strokeWidth={2.4} />}
          >
            {loading === "phone" ? "Sending…" : "Send code"}
          </NomadButton>

          <Text style={[styles.footer, { color: theme.inkMuted }]}>
            We&apos;ll text a 6-digit code to verify.{"\n"}● End-to-end encrypted ·
            nothing leaves your phone
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
    letterSpacing: -0.7,
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
    letterSpacing: -0.1,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 20,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerLabel: {
    fontSize: 10.5,
    letterSpacing: 1.2,
    fontWeight: "700",
    textTransform: "uppercase",
    fontFamily: NOMAD_FONTS.uiBold,
  },
  phoneRow: {
    flexDirection: "row",
    gap: 8,
    zIndex: 10,
  },
  dial: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
  },
  dialText: {
    fontFamily: NOMAD_FONTS.monoMedium,
    fontSize: 15,
    fontWeight: "600",
  },
  dialMenu: {
    position: "absolute",
    top: 56,
    left: 0,
    minWidth: 84,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    shadowColor: "#1A1612",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  dialMenuItem: {
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  phoneInput: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontFamily: NOMAD_FONTS.monoMedium,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  sendBtn: { marginTop: 12 },
  footer: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    marginTop: 22,
    letterSpacing: 0.3,
    lineHeight: 11 * 1.6,
  },
});
