import React from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { lightImpact } from "@/utils/haptics";
import { springs } from "./springs";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Scale while held; 1 disables the effect. */
  pressedScale?: number;
  haptic?: boolean;
}

/** Pressable that springs down while held and back on release, with an optional light haptic. */
export function PressableScale({
  style,
  pressedScale = 0.96,
  haptic = true,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        scale.set(withSpring(pressedScale, springs.press));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.set(withSpring(1, springs.snappy));
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic) lightImpact();
        onPress?.(event);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
