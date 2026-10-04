import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { springs } from "@/atoms/motion/springs";
import { selectionChanged } from "@/utils/haptics";
import { useAura } from "./useAura";

interface AuraSegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}

const PAD = 4;

/** Pill switch between a few views; the selected pill springs across. */
export function AuraSegmented<T extends string>({ options, value, onChange, style }: AuraSegmentedProps<T>) {
  const { c, f } = useAura();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const slot = width > 0 ? (width - PAD * 2) / options.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    x.set(withSpring(index * slot, springs.snappy));
  }, [index, slot, x]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View
      accessibilityRole="tablist"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: c.surface, borderColor: c.hairline }, style]}
    >
      {slot > 0 ? <Animated.View style={[styles.pill, { width: slot, backgroundColor: c.surfaceStrong, borderColor: c.hairline }, pillStyle]} /> : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              selectionChanged();
              onChange(option.value);
            }}
            style={styles.item}
          >
            <Text numberOfLines={1} style={[styles.label, { color: selected ? c.text : c.textMuted, fontFamily: f.semibold }]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", height: 42, borderRadius: 21, borderWidth: StyleSheet.hairlineWidth, padding: PAD },
  pill: { position: "absolute", top: PAD, bottom: PAD, left: PAD, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 14 },
});
