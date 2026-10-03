import React, { type RefObject } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";

const IOS_NATIVE_GLASS = Platform.OS === "ios" && isLiquidGlassAvailable();

/**
 * Frosted backdrop for floating chrome: native glass on iOS 26, system material blur on older
 * iOS, and a GPU blur of `blurTarget` on Android (which must not contain this view).
 */
export function GlassSurface({
  isDark,
  radius,
  blurTarget,
  style,
}: {
  isDark: boolean;
  radius: number;
  blurTarget?: RefObject<View | null>;
  style?: StyleProp<ViewStyle>;
}) {
  const shape = [StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" as const }, style];
  if (Platform.OS === "android") {
    return (
      <BlurView
        style={shape}
        intensity={isDark ? 55 : 65}
        tint={isDark ? "dark" : "light"}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={blurTarget}
        blurReductionFactor={2.5}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(10,12,18,0.3)" : "rgba(255,255,255,0.42)" }]} />
      </BlurView>
    );
  }
  if (IOS_NATIVE_GLASS) {
    return <GlassView style={shape} glassEffectStyle="regular" colorScheme={isDark ? "dark" : "light"} />;
  }
  return <BlurView style={shape} intensity={80} tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} />;
}
