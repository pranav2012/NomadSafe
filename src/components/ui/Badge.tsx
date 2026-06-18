import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";

type BadgeVariant = "default" | "success" | "error" | "warning";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = "default" }: BadgeProps) {
  const { colors, typography, spacing, radii } = useTheme();

  const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
    default: { bg: colors.surface, text: colors.textSecondary },
    success: { bg: colors.success + "20", text: colors.success },
    error: { bg: colors.error + "20", text: colors.error },
    warning: { bg: colors.warning + "20", text: colors.warning },
  };

  const { bg, text } = variantColors[variant];

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          borderRadius: radii.full,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
      ]}
    >
      <Text
        style={{
          color: text,
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start" },
});
