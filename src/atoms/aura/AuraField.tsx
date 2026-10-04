import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from "react-native-reanimated";
import { useAura } from "./useAura";

interface AuraFieldProps extends TextInputProps {
  label?: string;
  /** Shown to the right of the label (e.g. a currency switcher). */
  labelAction?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  error?: string | null;
  large?: boolean;
}

/** Text field with a label above and an accent ring that fades in on focus. */
export function AuraField({ label, labelAction, prefix, suffix, error, large, style, onFocus, onBlur, ...input }: AuraFieldProps) {
  const { c, f, accent } = useAura();
  const [focused, setFocused] = useState(false);
  const ring = useDerivedValue(() => withTiming(focused ? 1 : 0, { duration: 160 }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.get() }));

  return (
    <View style={styles.wrap}>
      {label || labelAction ? (
        <View style={styles.labelRow}>
          {label ? <Text style={[styles.label, { color: c.textSoft, fontFamily: f.medium }]}>{label}</Text> : <View />}
          {labelAction}
        </View>
      ) : null}
      <View style={[styles.box, large && styles.boxLarge, { backgroundColor: c.surface, borderColor: error ? "#FF4D5E" : c.hairline }]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, { borderColor: accent }, ringStyle]} />
        {prefix}
        <TextInput
          placeholderTextColor={c.textMuted}
          selectionColor={accent}
          {...input}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, large && styles.inputLarge, { color: c.text, fontFamily: large ? f.semibold : f.regular }, style]}
        />
        {suffix}
      </View>
      {error ? <Text style={[styles.error, { fontFamily: f.medium }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 13.5 },
  box: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  boxLarge: { minHeight: 68 },
  ring: { borderRadius: 16, borderWidth: 1.5 },
  input: { flex: 1, fontSize: 16, paddingVertical: 12 },
  inputLarge: { fontSize: 30, letterSpacing: -0.8 },
  error: { color: "#FF4D5E", fontSize: 12.5 },
});
