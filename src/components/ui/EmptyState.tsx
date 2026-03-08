import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./Button";

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  action?: {
    title: string;
    onPress: () => void;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  const { colors, typography, spacing } = useTheme();

  return (
    <View style={styles.container}>
      <Ionicons
        name={icon}
        size={64}
        color={colors.textTertiary}
        style={{ marginBottom: spacing.lg }}
      />
      <Text
        style={[
          styles.title,
          {
            color: colors.text,
            fontSize: typography.sizes.xl,
            fontWeight: typography.weights.semibold,
            marginBottom: spacing.sm,
          },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.description,
          {
            color: colors.textSecondary,
            fontSize: typography.sizes.base,
          },
        ]}
      >
        {description}
      </Text>
      {action && (
        <View style={{ marginTop: spacing["2xl"] }}>
          <Button title={action.title} onPress={action.onPress} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: { textAlign: "center" },
  description: { textAlign: "center", lineHeight: 22 },
});
