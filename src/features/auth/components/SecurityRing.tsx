import React, { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from "react-native-skia";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { auraSignal, auraStatusColors } from "@/constants/aura";
import { useAppActive } from "@/hooks/useAnimationsActive";
import { usePerfTier, type PerfTier } from "@/hooks/usePerfTier";

export type SecurityRingState = "idle" | "scanning" | "success";

const SUCCESS = auraSignal.ready;
const DANGER = auraSignal.danger;
const RING_RADIUS = 0.36;
const PHASE_WRAP = 1000;
const NO_BURST = 99;
// Flagships tick at the display rate; mid and low tiers at ~30 fps.
const TICK_S: Record<PerfTier, number> = { high: 0, mid: 0.033, low: 0.033 };

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const [C1, C2, C3] = auraStatusColors.calm.map(rgb);
const GREEN = rgb(SUCCESS);
const RED = rgb(DANGER);

// A segmented ring (60 ticks) framing the user's avatar, like a Face ID frame. Ticks are dim at
// rest and breathe slowly; `progress` lights them clockwise from the top (PIN digits); `scan` runs a
// comet that sweeps round leaving a fading trail; `success` closes the gaps into a solid green ring
// and `burstAge` sends one ring of light outward; `error` flashes everything red.
const RING_SKSL = `
uniform float2 center;
uniform float radius;
uniform float phase;
uniform float scan;
uniform float success;
uniform float error;
uniform float progress;
uniform float burstAge;
uniform float dark;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;
uniform float3 green;
uniform float3 red;

const float TAU = 6.2831853;
const float N = 60.0;

half4 main(float2 xy) {
  float2 d = xy - center;
  float r = length(d) / radius;
  float aaR = 1.0 / radius;

  float u = fract(atan(d.y, d.x) / TAU + 0.25);
  float seg = floor(u * N);
  float fu = fract(u * N);
  float us = (seg + 0.5) / N;
  float aaU = N / (TAU * max(r * radius, 1.0));
  float gap = 0.34 * (1.0 - success);
  float tick = smoothstep(gap * 0.5 - aaU, gap * 0.5 + aaU, fu) * smoothstep(gap * 0.5 - aaU, gap * 0.5 + aaU, 1.0 - fu);
  tick = mix(tick, 1.0, success);
  float band = smoothstep(0.86 - aaR, 0.86 + aaR, r) * (1.0 - smoothstep(1.0 - aaR, 1.0 + aaR, r));

  float breathe = 0.5 + 0.5 * sin(phase * 1.4);
  float rest = 0.2 + 0.08 * breathe;
  float filled = step(us, progress - 0.0001);
  float head = fract(phase * 0.55);
  float behind = fract(head - us);
  float comet = exp(-behind * 6.0) * scan;
  float lit = max(max(rest, filled), max(comet, success));

  float3 accent = mix(mix(c1, c2, smoothstep(0.0, 0.5, us)), c3, smoothstep(0.5, 1.0, us));
  float3 base = dark > 0.5 ? float3(0.55, 0.58, 0.68) : float3(0.45, 0.48, 0.58);
  float3 col = mix(base, accent, smoothstep(0.2, 0.9, lit));
  col = mix(col, green, success);
  col = mix(col, red, error);
  float alpha = band * tick * mix(0.35, 1.0, lit);

  float glowLit = max(max(filled * 0.6, comet), success);
  float glow = glowLit * 0.4 * exp(-abs(r - 0.93) * 9.0) * (1.0 - band * tick);
  float burstR = 1.0 + burstAge * 0.75;
  float burst = exp(-pow((r - burstR) * 14.0, 2.0)) * exp(-burstAge * 3.2);
  glow += burst * 0.8 + error * 0.35 * exp(-abs(r - 0.93) * 9.0);

  float a = clamp(alpha + glow * (dark > 0.5 ? 1.0 : 0.7), 0.0, 1.0);
  return half4(half3(col * a), half(a));
}
`;

let ringEffect: SkRuntimeEffect | null = null;
// Compiled on first use, not at import.
function ringShader() {
  return (ringEffect ??= Skia.RuntimeEffect.Make(RING_SKSL)!);
}

/**
 * Segmented security ring for the lock and PIN setup screens, framing `children` (the avatar or
 * lock icon). `progress` (0..1) lights ticks for PIN digits; `state` drives the scan sweep and the
 * green success close; bump `errorKey` to flash red and shake.
 */
export function SecurityRing({
  size,
  state,
  isDark,
  progress = 0,
  errorKey = 0,
  children,
}: {
  size: number;
  state: SecurityRingState;
  isDark: boolean;
  progress?: number;
  errorKey?: number;
  children?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const phase = useSharedValue(0);
  const now = useSharedValue(0);
  const scan = useSharedValue(state === "scanning" ? 1 : 0);
  const success = useSharedValue(state === "success" ? 1 : 0);
  const error = useSharedValue(0);
  const fill = useSharedValue(progress);
  const burstStart = useSharedValue(-NO_BURST);
  const shake = useSharedValue(0);
  const pending = useSharedValue(0);

  useEffect(() => {
    scan.set(withTiming(state === "scanning" ? 1 : 0, { duration: 280 }));
    success.set(withTiming(state === "success" ? 1 : 0, { duration: 360 }));
    if (state === "success") burstStart.set(now.get());
  }, [burstStart, now, scan, state, success]);

  useEffect(() => {
    fill.set(withTiming(progress, { duration: 160 }));
  }, [fill, progress]);

  useEffect(() => {
    if (errorKey === 0) return;
    error.set(withSequence(withTiming(1, { duration: 90 }), withTiming(0, { duration: 650 })));
    if (!reduceMotion) {
      shake.set(
        withSequence(
          withTiming(-8, { duration: 50 }),
          withTiming(8, { duration: 70 }),
          withTiming(-5, { duration: 60 }),
          withSpring(0, { damping: 8, stiffness: 300 }),
        ),
      );
    }
  }, [error, errorKey, reduceMotion, shake]);

  const tickS = TICK_S[usePerfTier()];

  const clock = useFrameCallback((frame) => {
    const elapsed = pending.get() + (frame.timeSincePreviousFrame ?? 16) / 1000;
    if (elapsed < tickS) {
      pending.set(elapsed);
      return;
    }
    pending.set(0);
    const dt = Math.min(elapsed, 0.1);
    phase.set((phase.get() + dt) % PHASE_WRAP);
    now.set(now.get() + dt);
  }, false);
  useEffect(() => {
    clock.setActive(appActive && !reduceMotion);
  }, [appActive, clock, reduceMotion]);

  const center = size / 2;
  const radius = size * RING_RADIUS;
  const dark = isDark ? 1 : 0;

  const uniforms = useDerivedValue(() => {
    const age = now.get() - burstStart.get();
    return {
      center: [center, center],
      radius,
      phase: phase.get(),
      scan: scan.get(),
      success: success.get(),
      error: error.get(),
      progress: fill.get(),
      burstAge: age >= 0 && age < 3 ? age : NO_BURST,
      dark,
      c1: C1,
      c2: C2,
      c3: C3,
      green: GREEN,
      red: RED,
    };
  });

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));

  return (
    <Animated.View style={[{ width: size, height: size }, shakeStyle]}>
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Rect x={0} y={0} width={size} height={size}>
          <Shader source={ringShader()} uniforms={uniforms} />
        </Rect>
      </Canvas>
      <View style={styles.center} pointerEvents="none">
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
});
