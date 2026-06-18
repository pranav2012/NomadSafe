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
import { LANGUAGE_OPTIONS, useLocalization } from "@/localization";

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();
  const { t, locale, deviceLocale } = useLocalization();
  const user = useAuthStore((s) => s.user);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const autoLockTimeout = useAuthStore((s) => s.autoLockTimeout);
  const setAutoLockTimeout = useAuthStore((s) => s.setAutoLockTimeout);
  const signOut = useAuthStore((s) => s.signOut);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const localeOverride = useSettingsStore((s) => s.localeOverride);
  const setLocaleOverride = useSettingsStore((s) => s.setLocaleOverride);
  const [signingOut, setSigningOut] = useState(false);
  const themeOptions = [
    { label: t("settings.themeLight"), value: "light" as const },
    { label: t("settings.themeDark"), value: "dark" as const },
    { label: t("settings.themeSystem"), value: "system" as const },
  ];
  const lockOptions = [
    { label: t("settings.lockImmediate"), value: 0 },
    { label: t("settings.lockOneMinute"), value: 60000 },
    { label: t("settings.lockFiveMinutes"), value: 300000 },
  ];

  const handleSignOut = async () => {
    Alert.alert(t("settings.signOutTitle"), t("settings.signOutBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("settings.signOut"),
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          try {
            await authClient.signOut();
          } catch (error) {
            void error;
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
        {t("settings.title")}
      </Text>

      <Card variant="elevated">
        <View style={styles.row}>
          <Avatar name={user?.name ?? t("common.fallbackUser")} imageUri={user?.avatarUrl} />
          <View style={{ marginLeft: spacing.md, flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.lg,
                fontWeight: typography.weights.semibold,
              }}
            >
              {user?.name ?? t("common.fallbackUser")}
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
              {user?.email ?? user?.phone ?? t("common.notSignedIn")}
            </Text>
          </View>
        </View>
      </Card>

      <Divider />

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
        {t("settings.appearance")}
      </Text>
      <Card>
        <View style={styles.optionRow}>
          {themeOptions.map((option) => (
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
        {t("settings.security")}
      </Text>
      <Card>
        <View style={[styles.settingRow, { marginBottom: spacing.lg }]}>
          <Text style={{ color: colors.text, fontSize: typography.sizes.base }}>
            {t("settings.biometricUnlock")}
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
          {t("settings.autoLock")}
        </Text>
        <View style={styles.optionRow}>
          {lockOptions.map((option) => (
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
        {t("settings.language")}
      </Text>
      <Card>
        <Button
          title={`${t("settings.languageDevice")} (${deviceLocale})`}
          onPress={() => setLocaleOverride(null)}
          variant={localeOverride === null ? "primary" : "ghost"}
          size="sm"
          fullWidth
        />
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
            marginTop: spacing.md,
            marginBottom: spacing.sm,
          }}
        >
          {t("settings.languageManual")}
        </Text>
        <View style={styles.languageGrid}>
          {LANGUAGE_OPTIONS.map((option) => (
            <Button
              key={option.locale}
              title={option.nativeLabel}
              onPress={() => setLocaleOverride(option.locale)}
              variant={
                localeOverride === option.locale || (!localeOverride && locale === option.locale)
                  ? "primary"
                  : "ghost"
              }
              size="sm"
            />
          ))}
        </View>
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
            marginTop: spacing.md,
          }}
        >
          {t("settings.languageFallback")}
        </Text>
      </Card>

      <Divider />

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
        {t("settings.about")}
      </Text>
      <Card>
        <View style={styles.settingRow}>
          <Text style={{ color: colors.text, fontSize: typography.sizes.base }}>
            {t("settings.version")}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.base }}>
            1.0.0
          </Text>
        </View>
      </Card>

      <View style={{ marginTop: spacing["3xl"], marginBottom: spacing["3xl"] }}>
        <Button
          title={t("settings.signOut")}
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
  languageGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
