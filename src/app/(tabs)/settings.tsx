import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { authClient } from "@/lib/auth-client";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { Avatar } from "@/components/ui/Avatar";

const THEME_OPTIONS = [
  { label: "Light", value: "light" as const },
  { label: "Dark", value: "dark" as const },
  { label: "System", value: "system" as const },
];

const LOCK_OPTIONS = [
  { label: "Immediate", value: 0 },
  { label: "1 minute", value: 60000 },
  { label: "5 minutes", value: 300000 },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const user = useAuthStore((s) => s.user);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const autoLockTimeout = useAuthStore((s) => s.autoLockTimeout);
  const setAutoLockTimeout = useAuthStore((s) => s.setAutoLockTimeout);
  const signOut = useAuthStore((s) => s.signOut);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await authClient.signOut();
          } catch {
            // Continue with local sign out
          }
          signOut();
          router.replace("/(auth)/sign-in");
        },
      },
    ]);
  };

  return (
    <Screen scroll>
      <Text
        style={{
          color: colors.text,
          fontSize: typography.sizes["2xl"],
          fontWeight: typography.weights.bold,
          marginBottom: spacing["2xl"],
          paddingTop: spacing.sm,
        }}
      >
        Settings
      </Text>

      {/* Account */}
      <Card variant="elevated">
        <View style={styles.row}>
          <Avatar name={user?.name ?? "User"} imageUri={user?.avatarUrl} />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.lg,
                fontWeight: typography.weights.semibold,
              }}
            >
              {user?.name ?? "User"}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
              {user?.email ?? user?.phone ?? "Not signed in"}
            </Text>
          </View>
        </View>
      </Card>

      <Divider />

      {/* Appearance */}
      <Text
        style={[
          styles.sectionTitle,
          {
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
          },
        ]}
      >
        APPEARANCE
      </Text>
      <Card>
        <View style={styles.optionRow}>
          {THEME_OPTIONS.map((option) => (
            <Button
              key={option.value}
              title={option.label}
              onPress={() => setThemeMode(option.value)}
              variant={themeMode === option.value ? "primary" : "ghost"}
              size="sm"
            />
          ))}
        </View>
      </Card>

      <Divider />

      {/* Security */}
      <Text
        style={[
          styles.sectionTitle,
          {
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
          },
        ]}
      >
        SECURITY
      </Text>
      <Card>
        <View style={[styles.settingRow, { marginBottom: spacing.lg }]}>
          <Text style={{ color: colors.text, fontSize: typography.sizes.base }}>
            Biometric Unlock
          </Text>
          <Switch
            value={biometricEnabled}
            onValueChange={setBiometricEnabled}
          />
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: typography.sizes.base,
            marginBottom: spacing.sm,
          }}
        >
          Auto-Lock
        </Text>
        <View style={styles.optionRow}>
          {LOCK_OPTIONS.map((option) => (
            <Button
              key={option.value}
              title={option.label}
              onPress={() => setAutoLockTimeout(option.value)}
              variant={autoLockTimeout === option.value ? "primary" : "ghost"}
              size="sm"
            />
          ))}
        </View>
      </Card>

      <Divider />

      {/* About */}
      <Text
        style={[
          styles.sectionTitle,
          {
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
            fontWeight: typography.weights.medium,
          },
        ]}
      >
        ABOUT
      </Text>
      <Card>
        <View style={styles.settingRow}>
          <Text style={{ color: colors.text, fontSize: typography.sizes.base }}>
            Version
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.base }}>
            1.0.0
          </Text>
        </View>
      </Card>

      <View style={{ marginTop: spacing["3xl"], marginBottom: spacing["3xl"] }}>
        <Button
          title="Sign Out"
          onPress={handleSignOut}
          variant="danger"
          fullWidth
          loading={signingOut}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  sectionTitle: {
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  optionRow: { flexDirection: "row", gap: 8 },
});
