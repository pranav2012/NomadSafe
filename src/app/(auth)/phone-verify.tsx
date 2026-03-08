import React, { useState, useRef, useEffect } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/authStore";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/layout/Screen";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

export default function PhoneVerifyScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { colors, typography, spacing, radii } = useTheme();
  const { isPinSet, setSignedIn, setUnlocked } = useAuthStore();

  const [code, setCode] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleChangeDigit = (text: string, index: number) => {
    if (text.length > 1) text = text[text.length - 1];
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);
    setError("");

    if (text && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const otp = code.join("");
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
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    try {
      await authClient.phoneNumber.sendOtp({ phoneNumber: phone! });
      setCooldown(RESEND_COOLDOWN);
    } catch {
      // Error resending
    }
  };

  return (
    <Screen scroll keyboardAvoiding edges={["top", "bottom"]}>
      <View style={styles.container}>
        <Text
          style={[
            styles.title,
            {
              color: colors.text,
              fontSize: typography.sizes["2xl"],
              fontWeight: typography.weights.bold,
            },
          ]}
        >
          Verify your number
        </Text>
        <Text
          style={[
            styles.subtitle,
            {
              color: colors.textSecondary,
              fontSize: typography.sizes.base,
              marginTop: spacing.sm,
              marginBottom: spacing["3xl"],
            },
          ]}
        >
          Enter the 6-digit code sent to {phone}
        </Text>

        <View style={styles.otpRow}>
          {code.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              value={digit}
              onChangeText={(text) => handleChangeDigit(text, index)}
              onKeyPress={({ nativeEvent }) =>
                handleKeyPress(nativeEvent.key, index)
              }
              keyboardType="number-pad"
              maxLength={1}
              style={[
                styles.otpInput,
                {
                  borderColor: digit
                    ? colors.borderFocused
                    : error
                      ? colors.error
                      : colors.border,
                  borderRadius: radii.md,
                  color: colors.text,
                  fontSize: typography.sizes["2xl"],
                  backgroundColor: colors.surface,
                },
              ]}
              autoFocus={index === 0}
            />
          ))}
        </View>

        {error && (
          <Text
            style={[
              styles.error,
              {
                color: colors.error,
                fontSize: typography.sizes.sm,
                marginTop: spacing.md,
              },
            ]}
          >
            {error}
          </Text>
        )}

        <View style={{ marginTop: spacing["3xl"], gap: spacing.md }}>
          <Button
            title="Verify"
            onPress={handleVerify}
            fullWidth
            size="lg"
            loading={loading}
            disabled={code.join("").length !== OTP_LENGTH}
          />

          <Button
            title={cooldown > 0 ? `Resend in ${cooldown}s` : "Resend Code"}
            onPress={handleResend}
            variant="ghost"
            fullWidth
            disabled={cooldown > 0}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
  title: {},
  subtitle: {},
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
  },
  otpInput: {
    width: 48,
    height: 56,
    borderWidth: 1.5,
    textAlign: "center",
    fontWeight: "700",
  },
  error: { textAlign: "center" },
});
