import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, Circle, SweepGradient, vec } from "react-native-skia";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { Icon, type IconName, PressableScale } from "@/atoms";
import { auraFonts, type AuraPalette } from "@/constants/aura";

interface ActionButtonProps {
  icon: IconName;
  label: string;
  palette: AuraPalette;
  accent: string;
  /** Sweeps a light beam around the rim, e.g. while location sharing is live. */
  live?: boolean;
  onPress?: () => void;
}

const SIZE = 60;
const BLEED = 18;
const CANVAS = SIZE + BLEED * 2;
const CENTER = CANVAS / 2;

/** Round action with a ripple ring on every press. */
export function ActionButton({ icon, label, palette, accent, live = false, onPress }: ActionButtonProps) {
  const ripple = useSharedValue(1);

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: (1 - ripple.get()) * 0.6,
    transform: [{ scale: (SIZE / 2 + ripple.get() * BLEED) / (CANVAS / 2) }],
  }));

  return (
    <View style={styles.root}>
      <View style={styles.stage}>
        <PressableScale
          onPress={() => {
            ripple.set(0);
            ripple.set(withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
            onPress?.();
          }}
          pressedScale={0.9}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[
            styles.button,
            { backgroundColor: palette.surfaceStrong, borderColor: live ? `${accent}66` : palette.hairline },
          ]}
        >
          <Icon name={icon} size={22} color={live ? accent : palette.text} strokeWidth={1.9} />
        </PressableScale>
        <Animated.View pointerEvents="none" style={[styles.canvas, styles.ripple, { borderColor: accent }, rippleStyle]} />
        {live ? <RimBeam accent={accent} /> : null}
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: palette.textSoft }]}>
        {label}
      </Text>
    </View>
  );
}

/** The beam is drawn once; a native rotation spins it, so Skia never redraws while it turns. */
function RimBeam({ accent }: { accent: string }) {
  const animating = useAnimationsActive();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (!animating || reduceMotion) {
      cancelAnimation(turn);
      return;
    }
    turn.set(turn.get() % 360);
    turn.set(withRepeat(withTiming(turn.get() + 360, { duration: 2222, easing: Easing.linear }), -1, false));
  }, [animating, reduceMotion, turn]);

  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));

  return (
    <Animated.View pointerEvents="none" style={[styles.canvas, spinStyle]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle cx={CENTER} cy={CENTER} r={SIZE / 2 - 0.75} style="stroke" strokeWidth={1.5}>
          <SweepGradient c={vec(CENTER, CENTER)} colors={[`${accent}00`, `${accent}00`, accent, `${accent}00`]} />
        </Circle>
      </Canvas>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 8, flex: 1 },
  stage: { width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" },
  canvas: { position: "absolute", width: CANVAS, height: CANVAS, left: -BLEED, top: -BLEED },
  ripple: { borderRadius: CANVAS / 2, borderWidth: 1.5 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontFamily: auraFonts.medium, fontSize: 12.5 },
});
