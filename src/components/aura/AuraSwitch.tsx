import React, { useEffect } from "react";
import { Pressable, StyleSheet } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { springs } from "@/components/motion/springs";
import { selectionChanged } from "@/utils/haptics";
import { useAura } from "./useAura";

const W = 50;
const H = 30;
const KNOB = 24;

/** On/off switch in Aura colours; the knob springs across and the track fills with the accent. */
export function AuraSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { c, accent } = useAura();
  const on = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    on.set(withSpring(value ? 1 : 0, springs.snappy));
  }, [on, value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [c.surfaceStrong, accent]),
  }));
  const knobStyle = useAnimatedStyle(() => ({ transform: [{ translateX: on.get() * (W - KNOB - 6) }] }));

  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        selectionChanged();
        onValueChange(!value);
      }}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Animated.View style={[styles.track, { borderColor: c.hairline }, trackStyle]}>
        <Animated.View style={[styles.knob, knobStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, borderWidth: StyleSheet.hairlineWidth, padding: 3 },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
