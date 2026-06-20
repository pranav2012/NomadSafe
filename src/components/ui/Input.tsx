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
import { NOMAD_FONTS } from "@/constants/nomadTokens";

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
  multiline?: boolean;
  numberOfLines?: number;
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
  multiline,
  numberOfLines,
}: InputProps) {
  const { nomad, typography, spacing, radii } = useTheme();
  const colors = nomad.colors;
  const [isFocused, setIsFocused] = useState(false);
  const focusProgress = useSharedValue(0);

  const animatedBorderStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [error ? colors.stamp : colors.hairline, colors.teal],
    );
    return { borderColor };
  });

  const handleFocus = () => {
    setIsFocused(true);
    focusProgress.set(withTiming(1, { duration: 200 }));
  };

  const handleBlur = () => {
    setIsFocused(false);
    focusProgress.set(withTiming(0, { duration: 200 }));
  };

  return (
    <View style={styles.container}>
      {label && (
        <Text
          style={[
            styles.label,
            {
              color: colors.inkDeep,
              fontFamily: NOMAD_FONTS.uiMedium,
              fontSize: typography.sizes.sm,
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
            backgroundColor: colors.paperSoft,
            paddingHorizontal: spacing.md,
            alignItems: multiline ? "flex-start" : "center",
          },
          animatedBorderStyle,
          error && !isFocused && { borderColor: colors.stamp },
        ]}
      >
        {leftIcon && (
          <Ionicons
            name={leftIcon}
            size={20}
            color={colors.inkMuted}
            style={styles.leftIcon}
          />
        )}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkMuted}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          numberOfLines={numberOfLines}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            { outlineWidth: 0 } as object,
            {
              color: colors.inkDeep,
              fontFamily: NOMAD_FONTS.ui,
              fontSize: typography.sizes.base,
            },
            multiline
              ? { minHeight: 96, textAlignVertical: "top", paddingVertical: 12 }
              : { height: 48 },
          ]}
        />

        {rightIcon && (
          <Pressable onPress={onRightIconPress} hitSlop={8}>
            <Ionicons
              name={rightIcon}
              size={20}
              color={colors.inkMuted}
            />
          </Pressable>
        )}
      </AnimatedView>

      {error && (
        <Text
          style={[
            styles.error,
            {
              color: colors.stamp,
              fontFamily: NOMAD_FONTS.ui,
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
    minHeight: 48,
  },
  leftIcon: { marginRight: 8 },
  input: { flex: 1 },
  error: {},
});
