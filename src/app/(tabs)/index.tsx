import React, { useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import { router } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { storage } from "@/stores/storage";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export default function HomeScreen() {
  const { colors, typography, spacing } = useTheme();
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
    Alert.alert("Storage cleared", "All local data has been erased.", [
      { text: "OK", onPress: () => router.replace("/") },
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
            Welcome back,
          </Text>
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes["2xl"],
              fontWeight: typography.weights.bold,
            }}
          >
            {user?.name ?? "Traveler"}
          </Text>
        </View>
        <Avatar name={user?.name ?? "User"} imageUri={user?.avatarUrl} />
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
            Quick Actions
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
            Start a trip, log an expense, or check safety alerts.
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
            Recent Activity
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: typography.sizes.sm }}>
            No recent activity yet. Start your first trip!
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
            Dev Tools
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: typography.sizes.sm,
              marginBottom: spacing.md,
            }}
          >
            Reset all local data and return to onboarding.
          </Text>
          <Button
            title="Clear Storage"
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
        title="Clear all storage?"
        actions={[
          { title: "Cancel", variant: "ghost", onPress: () => setClearModalVisible(false) },
          { title: "Clear", variant: "danger", onPress: handleClearStorage },
        ]}
      >
        <Text
          style={{
            color: colors.textSecondary,
            fontSize: typography.sizes.sm,
          }}
        >
          This will erase all local data (auth, settings, trips) and reload the app to onboarding. This cannot be undone.
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
