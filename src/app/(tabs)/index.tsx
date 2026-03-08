import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/authStore";
import { Screen } from "@/components/layout/Screen";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";

export default function HomeScreen() {
  const { colors, typography, spacing } = useTheme();
  const user = useAuthStore((s) => s.user);

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
      </View>
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
