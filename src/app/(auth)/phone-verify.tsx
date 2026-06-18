import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Platform,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { NOMAD_FONTS, getNomadTheme } from "@/constants/nomadTokens";
import { useThemeContext } from "@/providers/ThemeProvider";
import { useAuthStore } from "@/stores/authStore";
import { authClient } from "@/lib/auth-client";
import { NomadButton } from "@/components/nomad/Button";
import { Icon } from "@/components/nomad/Icon";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 28;
const CELLS = [0, 1, 2, 3, 4, 5];

export default function PhoneVerifyScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { isDark } = useThemeContext();
  const theme = getNomadTheme(isDark);
  const { isPinSet, setSignedIn, setUnlocked } = useAuthStore();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(RESEND_COOLDOWN);
  const inputRef = useRef<TextInput>(null);

  const filled = code.length === OTP_LENGTH;

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (secs <= 0) return;
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [secs]);

  const handleVerify = async (otp: string) => {
    if (otp.length !== OTP_LENGTH) return;
    try {
      setLoading(true);
      setError("");
      await authClient.phoneNumber.verify({ phoneNumber: phone!, code: otp });
      setSignedIn(true);
      if (!isPinSet) {
        router.replace("/(auth)/setup-pin");
      } else {
        setUnlocked(true);
        router.replace("/(tabs)");
      }
    } catch {
      setError("Invalid code. Please try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (v: string) => {
    const next = v.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(next);
    setError("");
    if (next.length === OTP_LENGTH) handleVerify(next);
  };

  const handleResend = async () => {
    if (secs > 0) return;
    try {
      await authClient.phoneNumber.sendOtp({ phoneNumber: phone! });
      setSecs(RESEND_COOLDOWN);
    } catch {
      void 0;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.paper }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "left", "right"]}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: theme.paperSoft, borderColor: theme.hairline }]}
          >
            <Icon name="chevronLeft" size={16} color={theme.inkSoft} />
          </Pressable>
        </View>

        <View style={styles.body}>
          {/* Phone mark */}
          <View style={[styles.mark, { backgroundColor: theme.inkDeep, shadowColor: "#1A1612" }]}>
            <Icon name="phone" size={26} color={theme.mustard} strokeWidth={2} />
          </View>

          <Text style={[styles.eyebrow, { color: theme.stamp }]}>Verify your number</Text>
          <Text style={[styles.headline, { color: theme.inkDeep }]}>
            Enter the{" "}
            <Text style={[styles.headlineItalic, { color: theme.teal }]}>6-digit</Text> code.
          </Text>
          <Text style={[styles.sub, { color: theme.inkSoft }]}>
            Sent to{" "}
            <Text style={[styles.subStrong, { color: theme.inkDeep }]}>
              {phone || "+44 7700 900000"}
            </Text>
            .{" "}
            <Text style={[styles.change, { color: theme.teal }]} onPress={() => router.back()}>
              Change
            </Text>
          </Text>

          {/* OTP cells */}
          <Pressable style={styles.cellsWrap} onPress={() => inputRef.current?.focus()}>
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={handleChange}
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              style={styles.hiddenInput}
              caretHidden
            />
            <View style={styles.cellsRow}>
              {CELLS.map((i) => {
                const active = i === code.length;
                const char = code[i];
                return (
                  <View
                    key={i}
                    style={[
                      styles.cell,
                      {
                        backgroundColor: theme.paperSoft,
                        borderColor: char
                          ? theme.inkDeep
                          : active
                            ? theme.teal
                            : error
                              ? theme.stamp
                              : theme.hairline,
                      },
                      active && {
                        shadowColor: theme.teal,
                        shadowOpacity: 0.25,
                        shadowRadius: 6,
                        elevation: 3,
                      },
                    ]}
                  >
                    <Text style={[styles.cellChar, { color: theme.inkDeep }]}>{char || ""}</Text>
                  </View>
                );
              })}
            </View>
          </Pressable>

          {error ? (
            <Text style={[styles.error, { color: theme.stamp }]}>{error}</Text>
          ) : null}

          <NomadButton
            theme={theme}
            variant="teal"
            full
            onPress={() => handleVerify(code)}
            style={[styles.verifyBtn, { opacity: filled && !loading ? 1 : 0.45 }]}
          >
            {loading ? "Verifying…" : "Verify"}
          </NomadButton>

          <Pressable onPress={handleResend} disabled={secs > 0} style={styles.resend}>
            <Text style={[styles.resendText, { color: secs > 0 ? theme.inkMuted : theme.teal }]}>
              {secs > 0 ? `Resend code in ${secs}s` : "Resend code"}
            </Text>
          </Pressable>

          <Text style={[styles.footer, { color: theme.inkMuted }]}>
            ● End-to-end encrypted · nothing leaves your phone
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: 18, paddingVertical: 8 },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, paddingHorizontal: 26, paddingTop: 12 },
  mark: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
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
    fontSize: 36,
    lineHeight: 36 * 1.02,
    marginTop: 6,
    letterSpacing: -0.7,
  },
  headlineItalic: { fontFamily: NOMAD_FONTS.displayItalic, fontStyle: "italic" },
  sub: {
    fontSize: 14,
    marginTop: 10,
    lineHeight: 14 * 1.5,
    fontFamily: NOMAD_FONTS.ui,
  },
  subStrong: { fontFamily: NOMAD_FONTS.monoMedium },
  change: { fontFamily: NOMAD_FONTS.uiSemi, fontWeight: "600" },
  cellsWrap: { marginTop: 26, position: "relative" },
  hiddenInput: {
    position: "absolute",
    opacity: 0,
    width: "100%",
    height: "100%",
    zIndex: 2,
  },
  cellsRow: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  cell: {
    flex: 1,
    aspectRatio: 1 / 1.18,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  cellChar: {
    fontFamily: NOMAD_FONTS.display,
    fontSize: 26,
    fontWeight: "500",
  },
  error: {
    marginTop: 14,
    fontSize: 13,
    fontFamily: NOMAD_FONTS.uiMedium,
    textAlign: "center",
  },
  verifyBtn: { marginTop: 26 },
  resend: { marginTop: 16, alignItems: "center" },
  resendText: {
    fontSize: 13,
    fontFamily: NOMAD_FONTS.uiSemi,
    fontWeight: "600",
  },
  footer: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: NOMAD_FONTS.mono,
    marginTop: "auto",
    marginBottom: Platform.OS === "ios" ? 20 : 16,
    letterSpacing: 0.3,
  },
});
