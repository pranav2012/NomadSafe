import React, { useState } from "react";
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  type KeyboardTypeOptions,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";

interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secureTextEntry?: boolean;
  leftIcon?: keyof typeof Ionicons.glyphMap;
  rightIcon?: keyof typeof Ionicons.glyphMap;
  onRightIconPress?: () => void;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words";
}

const AnimatedView = Animated.createAnimatedComponent(View);

export function Input({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  secureTextEntry = false,
  leftIcon,
  rightIcon,
  onRightIconPress,
  keyboardType = "default",
  autoCapitalize = "sentences",
}: InputProps) {
  const { colors, typography, spacing, radii } = useTheme();
  const [isFocused, setIsFocused] = useState(false);
  const focusProgress = useSharedValue(0);

  const animatedBorderStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [error ? colors.error : colors.border, colors.borderFocused],
    );
    return { borderColor };
  });

  const handleFocus = () => {
    setIsFocused(true);
    focusProgress.value = withTiming(1, { duration: 200 });
  };

  const handleBlur = () => {
    setIsFocused(false);
    focusProgress.value = withTiming(0, { duration: 200 });
  };

  return (
    <View style={styles.container}>
      {label && (
        <Text
          style={[
            styles.label,
            {
              color: colors.text,
              fontSize: typography.sizes.sm,
              fontWeight: typography.weights.medium,
              marginBottom: spacing.xs,
            },
          ]}
        >
          {label}
        </Text>
      )}

      <AnimatedView
        style={[
          styles.inputContainer,
          {
            borderRadius: radii.md,
            borderWidth: 1.5,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.md,
          },
          animatedBorderStyle,
          error && !isFocused && { borderColor: colors.error },
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={20}
            color={colors.textSecondary}
            style={styles.leftIcon}
          />
        )}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            {
              color: colors.text,
              fontSize: typography.sizes.base,
            },
          ]}
        />

        {rightIcon && (
          <Pressable onPress={onRightIconPress} hitSlop={8}>
            <Ionicons
              name={rightIcon}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </AnimatedView>

      {error && (
        <Text
          style={[
            styles.error,
            {
              color: colors.error,
              fontSize: typography.sizes.xs,
              marginTop: spacing.xs,
            },
          ]}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%" },
  label: {},
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
  },
  leftIcon: { marginRight: 8 },
  input: { flex: 1, height: "100%" },
  error: {},
});
