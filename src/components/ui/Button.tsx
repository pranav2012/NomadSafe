import React from "react";
import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { lightImpact } from "@/utils/haptics";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: "left" | "right";
  haptic?: boolean;
  fullWidth?: boolean;
}

const SIZE_MAP: Record<Size, { height: number; paddingHorizontal: number; fontSize: number }> = {
  sm: { height: 36, paddingHorizontal: 12, fontSize: 14 },
  md: { height: 44, paddingHorizontal: 16, fontSize: 16 },
  lg: { height: 52, paddingHorizontal: 20, fontSize: 18 },
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  iconPosition = "left",
  haptic = true,
  fullWidth = false,
}: ButtonProps) {
  const { colors, radii } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const sizeConfig = SIZE_MAP[size];

  const variantStyles = getVariantStyles(variant, colors);

  const handlePress = () => {
    if (disabled || loading) return;
    if (haptic) lightImpact();
    onPress();
  };

  const isDisabled = disabled || loading;
  const iconColor = variantStyles.textColor;

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => {
        scale.value = withSpring(0.97);
      }}
      onPressOut={() => {
        scale.value = withSpring(1);
      }}
      disabled={isDisabled}
      style={[
        styles.base,
        {
          height: sizeConfig.height,
          paddingHorizontal: sizeConfig.paddingHorizontal,
          borderRadius: radii.md,
          backgroundColor: variantStyles.bg,
          borderColor: variantStyles.border,
          borderWidth: variantStyles.borderWidth,
          opacity: isDisabled ? 0.5 : 1,
        },
        fullWidth && styles.fullWidth,
        animatedStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyles.textColor} />
      ) : (
        <>
          {icon && iconPosition === "left" && (
            <Ionicons
              name={icon}
              size={sizeConfig.fontSize}
              color={iconColor}
              style={styles.iconLeft}
            />
          )}
          <Text
            style={[
              styles.text,
              {
                fontSize: sizeConfig.fontSize,
                color: variantStyles.textColor,
              },
            ]}
          >
            {title}
          </Text>
          {icon && iconPosition === "right" && (
            <Ionicons
              name={icon}
              size={sizeConfig.fontSize}
              color={iconColor}
              style={styles.iconRight}
            />
          )}
        </>
      )}
    </AnimatedPressable>
  );
}

function getVariantStyles(
  variant: Variant,
  colors: ReturnType<typeof useTheme>["colors"],
) {
  switch (variant) {
    case "primary":
      return {
        bg: colors.primary,
        textColor: colors.primaryText,
        border: "transparent",
        borderWidth: 0,
      };
    case "secondary":
      return {
        bg: "transparent",
        textColor: colors.primary,
        border: colors.primary,
        borderWidth: 1.5,
      };
    case "ghost":
      return {
        bg: "transparent",
        textColor: colors.text,
        border: "transparent",
        borderWidth: 0,
      };
    case "danger":
      return {
        bg: colors.danger,
        textColor: colors.primaryText,
        border: "transparent",
        borderWidth: 0,
      };
  }
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  fullWidth: { width: "100%" },
  text: { fontWeight: "600" },
  iconLeft: { marginRight: 8 },
  iconRight: { marginLeft: 8 },
});
