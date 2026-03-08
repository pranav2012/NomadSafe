import React from "react";
import { Pressable, View, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { lightImpact } from "@/utils/haptics";
import type { spacing as SpacingType } from "@/constants/theme";

interface CardProps {
  children: React.ReactNode;
  variant?: "flat" | "elevated";
  onPress?: () => void;
  padding?: keyof typeof SpacingType;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Card({
  children,
  variant = "flat",
  onPress,
  padding = "lg",
}: CardProps) {
  const { colors, spacing, radii, shadows } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const cardStyle = [
    styles.card,
    {
      backgroundColor:
        variant === "elevated" ? colors.surfaceElevated : colors.surface,
      borderRadius: radii.lg,
      padding: spacing[padding],
    },
    variant === "elevated" && shadows.md,
  ];

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={() => {
          lightImpact();
          onPress();
        }}
        onPressIn={() => {
          scale.value = withSpring(0.98);
        }}
        onPressOut={() => {
          scale.value = withSpring(1);
        }}
        style={[cardStyle, animatedStyle]}
      >
        {children}
      </AnimatedPressable>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
});
