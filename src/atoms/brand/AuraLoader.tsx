import React, { useEffect } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Canvas } from "react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";
import { useAura } from "../aura/useAura";
import { NomadMark } from "./NomadMark";

const CYCLE_MS = 2200;
const DRAW_SPAN = 0.42;
const ERASE_AT = 0.58;

function easeInOut(t: number) {
  "worklet";
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Brand loader: the N draws in, holds, then erases from its start while the glow breathes. */
export function AuraLoader({
  size = 72,
  fullScreen = false,
  label,
  style,
}: {
  size?: number;
  /** Fills its parent on the app background and centres the mark. */
  fullScreen?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, f, isDark } = useAura();
  const { t } = useLocalization();
  const reduceMotion = useReducedMotion();
  const active = useAnimationsActive();
  const phase = useSharedValue(0.5);

  useEffect(() => {
    if (reduceMotion || !active) {
      cancelAnimation(phase);
      return;
    }
    phase.set(0);
    phase.set(withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(phase);
  }, [active, phase, reduceMotion]);

  const end = useDerivedValue(() => (reduceMotion ? 1 : easeInOut(phase.get() / DRAW_SPAN)));
  const start = useDerivedValue(() => (reduceMotion ? 0 : easeInOut((phase.get() - ERASE_AT) / (1 - ERASE_AT))));
  const glow = useDerivedValue(() => 0.55 + 0.45 * Math.sin(phase.get() * Math.PI));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? t("common.loading")}
      style={[fullScreen ? [styles.fullScreen, { backgroundColor: c.bg }] : styles.inline, style]}
    >
      <Canvas style={{ width: size, height: size }}>
        <NomadMark size={size} isDark={isDark} start={start} end={end} glow={glow} />
      </Canvas>
      {label ? <Text style={[styles.label, { color: c.textMuted, fontFamily: f.medium }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1, alignItems: "center", justifyContent: "center" },
  inline: { alignItems: "center", justifyContent: "center" },
  label: { fontSize: 14, marginTop: 4 },
});
