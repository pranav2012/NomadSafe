import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useAura } from "@/atoms";
import { auraStatusColors } from "@/constants/aura";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useLocalization } from "@/localization";

const STEPS = ["aiTab.thinking.thinking", "aiTab.thinking.reading", "aiTab.thinking.working", "aiTab.thinking.composing"] as const;
const STEP_MS = 2600;
const SWEEP_MS = 1500;
const SPREAD = 4;

/** One letter that lights up in the aura palette as the sweep passes over it. */
function ShimmerChar({
  char,
  index,
  count,
  sweep,
  base,
  font,
}: {
  char: string;
  index: number;
  count: number;
  sweep: SharedValue<number>;
  base: string;
  font: string;
}) {
  const [blue, teal, violet] = auraStatusColors.calm;
  const tint = count > 1 ? index / (count - 1) : 0;
  const style = useAnimatedStyle(() => {
    const head = sweep.get() * (count + SPREAD * 2) - SPREAD;
    const lit = Math.max(0, 1 - Math.abs(index - head) / SPREAD);
    const highlight = interpolateColor(tint, [0, 0.5, 1], [blue, teal, violet]);
    return { color: interpolateColor(lit, [0, 1], [base, highlight]) };
  });
  return <Animated.Text style={[styles.text, { fontFamily: font }, style]}>{char}</Animated.Text>;
}

/** Placeholder for a reply that hasn't started: a shimmering status line that steps through what the assistant is doing. */
export function AiThinking() {
  const { c, f } = useAura();
  const { t } = useLocalization();
  const reduceMotion = useReducedMotion();
  const animating = useAnimationsActive();
  const sweep = useSharedValue(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!animating || reduceMotion) {
      cancelAnimation(sweep);
      return;
    }
    sweep.set(0);
    sweep.set(withRepeat(withTiming(1, { duration: SWEEP_MS, easing: Easing.inOut(Easing.quad) }), -1, false));
  }, [animating, reduceMotion, sweep]);

  useEffect(() => {
    const id = setInterval(() => setStep((value) => (value + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const label = t(STEPS[step]);
  const chars = Array.from(label);

  return (
    <View accessible accessibilityLiveRegion="polite" accessibilityLabel={label} style={styles.wrap}>
      <Animated.View key={step} entering={FadeIn.duration(320)} style={styles.row}>
        {chars.map((char, index) => (
          <ShimmerChar key={index} char={char} index={index} count={chars.length} sweep={sweep} base={c.textMuted} font={f.medium} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 23, justifyContent: "center" },
  row: { flexDirection: "row", flexWrap: "wrap" },
  text: { fontSize: 15.5, lineHeight: 23 },
});
