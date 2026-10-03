import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { BlurMask, Canvas, Circle, Group, RadialGradient, vec } from "react-native-skia";
import {
  interpolateColor,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { auraStatusColors } from "@/constants/aura";
import { useAppActive } from "@/hooks/useAnimationsActive";

export type AuraOrbMode = "idle" | "listening" | "thinking" | "done";

const CALM = auraStatusColors.calm;
const LIVE = auraStatusColors.live;
const DONE = ["#3DDC97", "#22C7B8", "#8BE8C0"] as const;

/**
 * Three blurred blobs orbiting a glassy core. They swell with `level` (mic volume, -2..10) while
 * listening, swirl faster and warm to the live palette while thinking, and turn green when done.
 * Shared by voice capture, the lock screen and the AI tab. Pass `paused` when it's offscreen.
 */
export function AuraOrb({
  size,
  mode,
  level = 0,
  isDark,
  core = true,
  paused = false,
}: {
  size: number;
  mode: AuraOrbMode;
  level?: number;
  isDark: boolean;
  core?: boolean;
  paused?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const phase = useSharedValue(0);
  const speed = useSharedValue(0.35);
  const energy = useSharedValue(0);
  const warm = useSharedValue(0);
  const done = useSharedValue(0);

  useEffect(() => {
    speed.set(withTiming(reduceMotion ? 0 : mode === "thinking" ? 2.2 : mode === "listening" ? 0.9 : 0.35, { duration: 600 }));
    warm.set(withTiming(mode === "thinking" ? 1 : 0, { duration: 500 }));
    done.set(withTiming(mode === "done" ? 1 : 0, { duration: 500 }));
  }, [done, mode, reduceMotion, speed, warm]);

  useEffect(() => {
    // expo-speech-recognition reports roughly -2..10; map to 0..1.
    const normalized = mode === "listening" ? Math.min(1, Math.max(0, (level + 2) / 12)) : mode === "thinking" ? 0.35 : 0;
    energy.set(withSpring(normalized, { damping: 14, stiffness: 160 }));
  }, [energy, level, mode]);

  const orbit = useFrameCallback((frame) => {
    phase.set(phase.get() + ((frame.timeSincePreviousFrame ?? 16) / 1000) * speed.get());
  }, false);
  useEffect(() => {
    orbit.setActive(appActive && !paused && !reduceMotion);
  }, [appActive, orbit, paused, reduceMotion]);

  const center = size / 2;
  const blob = size * 0.22;

  const coreR = useDerivedValue(() => size * 0.2 * (1 + energy.get() * 0.18));
  const glowR = useDerivedValue(() => size * 0.34 * (1 + energy.get() * 0.3));
  const glowColor = useDerivedValue(() => {
    const base = interpolateColor(warm.get(), [0, 1], [CALM[0], LIVE[0]]);
    return interpolateColor(done.get(), [0, 1], [base, DONE[0]]);
  });

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle cx={center} cy={center} r={glowR} color={glowColor} opacity={isDark ? 0.22 : 0.16}>
          <BlurMask blur={size * 0.12} style="normal" />
        </Circle>
        <Group>
          <BlurMask blur={size * 0.07} style="normal" />
          {[0, 1, 2].map((index) => (
            <OrbBlob key={index} index={index} center={center} radius={blob} phase={phase} energy={energy} warm={warm} done={done} size={size} />
          ))}
        </Group>
        {core ? (
          <Circle cx={center} cy={center} r={coreR}>
            <RadialGradient
              c={vec(center - size * 0.05, center - size * 0.06)}
              r={size * 0.24}
              colors={isDark ? ["rgba(255,255,255,0.55)", "rgba(255,255,255,0.08)"] : ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.35)"]}
            />
          </Circle>
        ) : null}
      </Canvas>
    </View>
  );
}

function OrbBlob({
  index,
  center,
  radius,
  phase,
  energy,
  warm,
  done,
  size,
}: {
  index: number;
  center: number;
  radius: number;
  phase: SharedValue<number>;
  energy: SharedValue<number>;
  warm: SharedValue<number>;
  done: SharedValue<number>;
  size: number;
}) {
  const offset = (index * Math.PI * 2) / 3;
  const cx = useDerivedValue(() => {
    const orbit = size * (0.08 + energy.get() * 0.07);
    return center + Math.cos(phase.get() * (1 + index * 0.25) + offset) * orbit;
  });
  const cy = useDerivedValue(() => {
    const orbit = size * (0.08 + energy.get() * 0.07);
    return center + Math.sin(phase.get() * (1 + index * 0.25) + offset) * orbit;
  });
  const r = useDerivedValue(() => radius * (1 + energy.get() * 0.35));
  const color = useDerivedValue(() => {
    const base = interpolateColor(warm.get(), [0, 1], [CALM[index], LIVE[index]]);
    return interpolateColor(done.get(), [0, 1], [base, DONE[index]]);
  });
  return <Circle cx={cx} cy={cy} r={r} color={color} />;
}
