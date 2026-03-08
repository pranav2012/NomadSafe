import React, { useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/authStore";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Screen } from "@/components/layout/Screen";

export default function SignInScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { isPinSet, setSignedIn, setUnlocked } = useAuthStore();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

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
    } catch {
      // User cancelled or error
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
    } catch {
      // User cancelled or error
    } finally {
      setLoading(null);
    }
  };

  const handlePhoneSendOTP = async () => {
    if (!phone.trim()) return;
    try {
      setLoading("phone");
      await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
      router.push({
        pathname: "/(auth)/phone-verify",
        params: { phone },
      });
    } catch {
      // Error sending OTP
    } finally {
      setLoading(null);
    }
  };

  return (
    <Screen scroll keyboardAvoiding edges={["top", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text
            style={[
              styles.title,
              {
                color: colors.text,
                fontSize: typography.sizes["4xl"],
                fontWeight: typography.weights.bold,
              },
            ]}
          >
            Welcome to{"\n"}NomadSafe
          </Text>
          <Text
            style={[
              styles.subtitle,
              {
                color: colors.textSecondary,
                fontSize: typography.sizes.base,
                marginTop: spacing.sm,
              },
            ]}
          >
            Sign in to get started
          </Text>
        </View>

        <View style={[styles.buttons, { gap: spacing.md }]}>
          <Button
            title="Continue with Google"
            onPress={handleGoogleSignIn}
            icon="logo-google"
            variant="secondary"
            fullWidth
            size="lg"
            loading={loading === "google"}
          />

          {Platform.OS === "ios" && (
            <Button
              title="Continue with Apple"
              onPress={handleAppleSignIn}
              icon="logo-apple"
              variant="secondary"
              fullWidth
              size="lg"
              loading={loading === "apple"}
            />
          )}

          <View style={styles.dividerRow}>
            <View
              style={[styles.dividerLine, { backgroundColor: colors.border }]}
            />
            <Text
              style={{
                color: colors.textSecondary,
                fontSize: typography.sizes.sm,
                marginHorizontal: spacing.md,
              }}
            >
              or
            </Text>
            <View
              style={[styles.dividerLine, { backgroundColor: colors.border }]}
            />
          </View>

          <Input
            label="Phone Number"
            placeholder="+1 (234) 567-8900"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            leftIcon="call-outline"
          />

          <Button
            title="Send OTP"
            onPress={handlePhoneSendOTP}
            fullWidth
            size="lg"
            loading={loading === "phone"}
            disabled={!phone.trim()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center" },
  header: { marginBottom: 48 },
  title: {},
  subtitle: {},
  buttons: {},
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 8,
  },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
});
