import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";

/** Status dot with a halo that ripples outward while `active`. */
export function LiveDot({ color, size = 8, active = true }: { color: string; size?: number; active?: boolean }) {
  const ripple = useSharedValue(0);
  const visible = useAnimationsActive();

  useEffect(() => {
    if (active && !visible) {
      cancelAnimation(ripple);
      return;
    }
    ripple.set(active
      ? withRepeat(withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }), -1, false)
      : withTiming(0));
  }, [active, ripple, visible]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: active ? 0.55 * (1 - ripple.get()) : 0,
    transform: [{ scale: 1 + ripple.get() * 1.8 }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }, haloStyle]}
      />
      <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, backgroundColor: color }]} />
    </View>
  );
}
