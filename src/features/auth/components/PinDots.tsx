import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useAura } from "@/components/aura/useAura";
import { springs } from "@/components/motion/springs";

const ERROR = "#FF4D5E";
const DOT = 12;

interface PinDotsProps {
  length: number;
  filled: number;
  /** Increment to play the error shake. */
  shakeKey?: number;
  error?: boolean;
  accent?: string;
}

/** Row of PIN dots that fill with the accent and shake on a wrong entry. */
export function PinDots({ length, filled, shakeKey = 0, error = false, accent }: PinDotsProps) {
  const { c, accent: auraAccent } = useAura();
  const shakeX = useSharedValue(0);

  useEffect(() => {
    if (shakeKey === 0) return;
    shakeX.set(
      withSequence(
        withTiming(-12, { duration: 45 }),
        withTiming(12, { duration: 70 }),
        withTiming(-8, { duration: 60 }),
        withTiming(8, { duration: 60 }),
        withSpring(0, springs.snappy),
      ),
    );
  }, [shakeKey, shakeX]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.get() }] }));

  return (
    <Animated.View style={[styles.row, rowStyle]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length }).map((_, i) => (
        <Dot key={i} on={i < filled} color={error ? ERROR : (accent ?? auraAccent)} empty={c.hairline} ring={c.textMuted} />
      ))}
    </Animated.View>
  );
}

function Dot({ on, color, empty, ring }: { on: boolean; color: string; empty: string; ring: string }) {
  const fill = useSharedValue(on ? 1 : 0);

  useEffect(() => {
    fill.set(on ? withSpring(1, springs.bouncy) : withTiming(0, { duration: 140 }));
  }, [fill, on]);

  const style = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(Math.min(1, fill.get()), [0, 1], [empty, color]),
    borderColor: interpolateColor(Math.min(1, fill.get()), [0, 1], [ring, color]),
    transform: [{ scale: 0.85 + fill.get() * 0.3 }],
  }));

  return (
    <View style={styles.cell}>
      <Animated.View style={[styles.dot, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 14, alignItems: "center", justifyContent: "center" },
  cell: { width: DOT + 6, height: DOT + 6, alignItems: "center", justifyContent: "center" },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 1.5 },
});
