import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";

interface HeaderProps {
  title: string;
  showBack?: boolean;
  rightAction?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  };
}

export function Header({ title, showBack = false, rightAction }: HeaderProps) {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.left}>
        {showBack && (
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons
              name="chevron-back"
              size={24}
              color={colors.text}
            />
          </Pressable>
        )}
      </View>

      <Text
        style={[
          styles.title,
          {
            color: colors.text,
            fontSize: typography.sizes.lg,
            fontWeight: typography.weights.semibold,
          },
        ]}
      >
        {title}
      </Text>

      <View style={styles.right}>
        {rightAction && (
          <Pressable onPress={rightAction.onPress} hitSlop={8}>
            <Ionicons
              name={rightAction.icon}
              size={24}
              color={colors.text}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: { width: 40 },
  title: { flex: 1, textAlign: "center" },
  right: { width: 40, alignItems: "flex-end" },
});
