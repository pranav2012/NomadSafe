import React, { useState, type RefObject } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedReaction, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";

const IOS_NATIVE_GLASS = Platform.OS === "ios" && isLiquidGlassAvailable();

/**
 * Frosted backdrop for floating chrome: native glass on iOS 26, system material blur on older
 * iOS, and a GPU blur of `blurTarget` on Android (which must not contain this view).
 * `clarity="clear"` is the lighter, more see-through Android glass the tab bar uses; surfaces
 * holding text input stay frosted. `clearing` (0..1, Android) fades to a lighter, sharper glass,
 * as iOS 26 glass does while it's pressed.
 */
export function GlassSurface({
  isDark,
  radius,
  blurTarget,
  clarity = "frosted",
  clearing,
  style,
}: {
  isDark: boolean;
  radius: number;
  blurTarget?: RefObject<View | null>;
  clarity?: "frosted" | "clear";
  clearing?: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
}) {
  const shape = [StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" as const }, style];
  if (Platform.OS === "android") {
    const clear = clarity === "clear";
    const tint = isDark
      ? `rgba(10,12,18,${clear ? 0.14 : 0.3})`
      : `rgba(255,255,255,${clear ? 0.2 : 0.42})`;
    return (
      <>
        <BlurView
          style={shape}
          intensity={clear ? (isDark ? 28 : 34) : isDark ? 55 : 65}
          tint={isDark ? "dark" : "light"}
          blurMethod="dimezisBlurViewSdk31Plus"
          blurTarget={blurTarget}
          blurReductionFactor={2.5}
        >
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
        </BlurView>
        {clearing ? <ClearGlass progress={clearing} isDark={isDark} shape={shape} blurTarget={blurTarget} /> : null}
      </>
    );
  }
  if (IOS_NATIVE_GLASS) {
    return <GlassView style={shape} glassEffectStyle="regular" colorScheme={isDark ? "dark" : "light"} />;
  }
  return <BlurView style={shape} intensity={80} tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} />;
}

// Lighter blur faded in over the glass; mounted only while `progress` > 0, so idle costs one blur pass.
function ClearGlass({
  progress,
  isDark,
  shape,
  blurTarget,
}: {
  progress: SharedValue<number>;
  isDark: boolean;
  shape: StyleProp<ViewStyle>;
  blurTarget?: RefObject<View | null>;
}) {
  const [mounted, setMounted] = useState(false);
  useAnimatedReaction(
    () => progress.get() > 0.001,
    (on, was) => {
      if (on !== was) scheduleOnRN(setMounted, on);
    },
  );
  const fade = useAnimatedStyle(() => ({ opacity: Math.min(1, progress.get()) }));
  if (!mounted) return null;
  return (
    <Animated.View style={[shape, fade]} pointerEvents="none">
      <BlurView
        style={StyleSheet.absoluteFill}
        intensity={isDark ? 8 : 10}
        tint={isDark ? "dark" : "light"}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={blurTarget}
        blurReductionFactor={2.5}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.22)" }]} />
      </BlurView>
    </Animated.View>
  );
}
