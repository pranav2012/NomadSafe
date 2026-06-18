import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/features/auth";
import { useSettingsStore } from "@/features/settings";
import { storage } from "@/stores/storage";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useLocalization } from "@/localization";

export default function HomeScreen() {
  const { colors, typography, spacing } = useTheme();
  const { t } = useLocalization();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const setPinSet = useAuthStore((s) => s.setPinSet);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);
  const setUnlocked = useAuthStore((s) => s.setUnlocked);
  const setOnboardingCompleted = useSettingsStore(
    (s) => s.setOnboardingCompleted,
  );
  const [clearModalVisible, setClearModalVisible] = useState(false);

  const handleClearStorage = () => {
    setClearModalVisible(false);
    storage.clearAll();
    signOut();
    setPinSet(false);
    setBiometricEnabled(false);
    setUnlocked(false);
    setOnboardingCompleted(false);
    Alert.alert(t("home.storageClearedTitle"), t("home.storageClearedBody"), [
      { text: t("common.ok"), onPress: () => router.replace("/") },
    ]);
  };

  return (
    <Screen scroll>
      <View style={[styles.header, { marginBottom: spacing["2xl"] }]}>
        <View>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: typography.sizes.base,
            }}
          >
            {t("home.welcomeBack")}
          </Text>
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes["2xl"],
              fontWeight: typography.weights.bold,
            }}
          >
            {user?.name ?? t("common.fallbackTraveler")}
          </Text>
        </View>
        <Avatar name={user?.name ?? t("common.fallbackUser")} imageUri={user?.avatarUrl} />
      </View>

      <View style={{ gap: spacing.md }}>
        <Card variant="elevated">
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.semibold,
              marginBottom: spacing.sm,
            }}
          >
            {t("home.quickActionsTitle")}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
            {t("home.quickActionsBody")}
          </Text>
        </Card>

        <Card variant="elevated">
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.semibold,
              marginBottom: spacing.sm,
            }}
          >
            {t("home.recentActivityTitle")}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
            {t("home.recentActivityBody")}
          </Text>
        </Card>

        <Card variant="elevated">
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.lg,
              fontWeight: typography.weights.semibold,
              marginBottom: spacing.sm,
            }}
          >
            {t("home.devToolsTitle")}
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: typography.sizes.sm,
              marginBottom: spacing.md,
            }}
          >
            {t("home.devToolsBody")}
          </Text>
          <Button
            title={t("home.clearStorage")}
            variant="danger"
            icon="trash-outline"
            fullWidth
            onPress={() => setClearModalVisible(true)}
          />
        </Card>
      </View>

      <Modal
        visible={clearModalVisible}
        onClose={() => setClearModalVisible(false)}
        title={t("home.clearStorageTitle")}
        actions={[
          { title: t("common.cancel"), variant: "ghost", onPress: () => setClearModalVisible(false) },
          { title: t("common.clear"), variant: "danger", onPress: handleClearStorage },
        ]}
      >
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
          }}
        >
          {t("home.clearStorageBody")}
        </Text>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
  },
});
