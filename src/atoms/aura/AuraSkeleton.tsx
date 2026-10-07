import React, { useEffect } from "react";
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { auraRadius, auraSpace } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";
import { useAura } from "./useAura";

const SWEEP_MS = 1300;
const PAUSE_MS = 350;
const BAND = 0.6;

/** Loading placeholder block with a UI-thread shimmer; static with reduce motion, paused when not visible. */
export function AuraSkeleton({
  width = "100%",
  height = 14,
  radius = 7,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, isDark } = useAura();
  const reduceMotion = useReducedMotion();
  const active = useAnimationsActive();
  const progress = useSharedValue(0);
  const size = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !active) {
      cancelAnimation(progress);
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(withTiming(1, { duration: SWEEP_MS + PAUSE_MS, easing: Easing.inOut(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [active, progress, reduceMotion]);

  // The band travels from fully left of the block to fully right, then rests off-screen for PAUSE_MS.
  const bandStyle = useAnimatedStyle(() => {
    const w = size.get();
    const band = w * BAND;
    const t = Math.min(1, progress.get() * ((SWEEP_MS + PAUSE_MS) / SWEEP_MS));
    return { width: band, transform: [{ translateX: -band + t * (w + band) }] };
  });

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => size.set(event.nativeEvent.layout.width)}
      style={[styles.block, { width, height, borderRadius: radius, backgroundColor: c.hairline }, style]}
    >
      {reduceMotion ? null : (
        <Animated.View pointerEvents="none" style={[styles.band, bandStyle]}>
          <LinearGradient
            colors={isDark ? ["rgba(255,255,255,0)", "rgba(255,255,255,0.07)", "rgba(255,255,255,0)"] : ["rgba(255,255,255,0)", "rgba(255,255,255,0.75)", "rgba(255,255,255,0)"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/** Announces one "Loading" to screen readers for a group of skeleton blocks. */
export function AuraSkeletonGroup({ children, label, style }: { children: React.ReactNode; label?: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useLocalization();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label ?? t("common.loading")} style={style}>
      {children}
    </View>
  );
}

/** Lines of placeholder text; the last line is shorter, like a wrapped paragraph. */
export function AuraSkeletonText({
  lines = 2,
  lineHeight = 12,
  gap = auraSpace.sm,
  lastWidth = "60%",
  style,
}: {
  lines?: number;
  lineHeight?: number;
  gap?: number;
  lastWidth?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap }, style]}>
      {Array.from({ length: lines }, (_, index) => (
        <AuraSkeleton
          key={index}
          height={lineHeight}
          radius={lineHeight / 2}
          width={index === lines - 1 && lines > 1 ? lastWidth : "100%"}
        />
      ))}
    </View>
  );
}

/** List row placeholder: avatar or thumbnail, title and detail lines, optional trailing block. */
export function AuraSkeletonRow({
  leading = "circle",
  size = 40,
  trailing = false,
  style,
}: {
  leading?: "circle" | "square" | "none";
  size?: number;
  trailing?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.row, style]}>
      {leading === "none" ? null : (
        <AuraSkeleton width={size} height={size} radius={leading === "circle" ? size / 2 : auraRadius.iconTile} />
      )}
      <View style={styles.rowText}>
        <AuraSkeleton width="62%" height={13} radius={6.5} />
        <AuraSkeleton width="38%" height={11} radius={5.5} />
      </View>
      {trailing ? <AuraSkeleton width={56} height={13} radius={6.5} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0, left: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: auraSpace.md },
  rowText: { flex: 1, minWidth: 0, gap: auraSpace.sm },
});
