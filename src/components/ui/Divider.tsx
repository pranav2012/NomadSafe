import React from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import type { spacing as SpacingType } from "@/constants/theme";

interface DividerProps {
  spacing?: keyof typeof SpacingType;
}

export function Divider({ spacing: spacingKey = "lg" }: DividerProps) {
  const { colors, spacing } = useTheme();

  return (
    <View
      style={[
        styles.divider,
        {
          backgroundColor: colors.border,
          marginVertical: spacing[spacingKey],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth, width: "100%" },
});
