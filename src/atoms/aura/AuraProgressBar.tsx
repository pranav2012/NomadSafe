import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useAura } from "./useAura";

/** Thin rounded progress track; `value` is 0–1 and is clamped. */
export function AuraProgressBar({
  value,
  tone,
  accessibilityLabel,
  style,
}: {
  value: number;
  tone?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, accent } = useAura();
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { backgroundColor: c.hairline }, style]}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: tone ?? accent }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 4 },
});
