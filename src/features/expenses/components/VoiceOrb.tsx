import React, { useEffect } from "react";
import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from "react-native-skia";
import { View } from "react-native";
import {
  useAnimatedReaction,
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
import { usePerfTier, type PerfTier } from "@/hooks/usePerfTier";

export type VoiceOrbMode = "idle" | "listening" | "thinking" | "done";

const DONE = "#3DDC97";
const DISC_RADIUS = 0.25;
const PHASE_WRAP = 1000;
// The bars redraw at the display rate on flagships and ~30 fps on mid/low tiers; the mic level is sampled on the same tick.
const TICK_S: Record<PerfTier, number> = { high: 0, mid: 0.033, low: 0.033 };

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const [C1, C2, C3] = auraStatusColors.calm.map(rgb);
const GREEN = rgb(DONE);

// A solid disc (the mic button) inside one ring of 64 spectrum bars in the aura colours. The bars
// are the same in every state and morph between them: a slow wave at rest, bouncing with the mic
// `level` while listening, a crest sweeping round while thinking, and calm green when done.
const VOICE_SKSL = `
uniform float2 center;
uniform float radius;
uniform float limit;
uniform float phase;
uniform float level;
uniform float listen;
uniform float think;
uniform float done;
uniform float dark;
uniform float4 disc;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;
uniform float3 green;

const float TAU = 6.2831853;
const float BARS = 64.0;

float3 palette(float u, float3 a, float3 b, float3 c) {
  return mix(mix(a, b, 0.5 + 0.5 * sin(u * TAU)), c, 0.5 + 0.5 * cos(u * TAU));
}

half4 main(float2 xy) {
  float2 p = (xy - center) / radius;
  float r = length(p);
  float a = atan(p.y, p.x);
  float aa = 1.2 / radius;
  float u = fract(a / TAU + 0.25);

  // One ring of 64 rounded bars in every state; only their heights and colours change, blended by
  // the state weights so each transition morphs the same bars. Idle: a slow wave travels round.
  // Listening: mic level times a per-bar jitter. Thinking: a bright crest sweeps round.
  // Done: even, calm and green.
  float bseg = floor(u * BARS);
  float bu = fract(u * BARS);
  float us = (bseg + 0.5) / BARS;
  float hs = fract(sin(bseg * 12.9898 + 1.0) * 43758.5453);

  float idleH = 0.03 + 0.035 * pow(0.5 + 0.5 * sin(us * TAU * 2.0 - phase * 1.1), 2.0);
  float jig = 0.5 + 0.5 * sin(phase * (4.0 + hs * 5.0) + hs * TAU) * sin(phase * (2.3 + hs * 3.0) + bseg * 0.9);
  float listenH = 0.035 + 0.012 * sin(phase * 2.0 + bseg * 0.4) + level * 0.55 * (0.3 + 0.7 * jig);
  float crest = exp(-fract(fract(phase * 0.45) - us) * 6.0);
  float thinkH = 0.03 + 0.2 * crest;
  float doneH = 0.05;

  float wIdle = max(0.0, 1.0 - listen - think - done);
  float total = wIdle + listen + think + done;
  float hgt = (wIdle * idleH + listen * listenH + think * thinkH + done * doneH) / total;
  float bright = (wIdle * 0.6 + listen * (0.75 + 0.6 * smoothstep(0.05, 0.45, listenH))
                + think * (0.4 + 0.8 * crest) + done * 1.0) / total;

  float x = (bu - 0.5) * (TAU / BARS) * r * radius;
  float y = (r - 1.12) * radius;
  float hpx = hgt * radius;
  float wpx = max(0.42 * (TAU / BARS) * 1.12 * radius, 1.5);
  float sd = length(float2(x, y - clamp(y, 0.0, hpx))) - wpx * 0.5;
  float bar = 1.0 - smoothstep(-0.8, 0.8, sd);
  float barGlow = 0.35 * exp(-max(sd, 0.0) / 1.5);
  float3 barCol = mix(palette(u, c1, c2, c3), green, done) * bright;
  float3 col = barCol * (bar + barGlow);
  float alpha = (bar + barGlow * 0.8) * clamp(bright, 0.5, 1.0);

  float inDisc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  float3 discCol = disc.rgb + mix(c1, green, done) * (0.1 * listen + 0.12 * done) * (1.0 - r * 0.5);
  float discA = max(disc.a, 0.0);
  float glow = exp(-max(r - 1.0, 0.0) * 6.0) * (0.12 + 0.25 * level * listen) * (1.0 - inDisc);
  float3 glowCol = mix(c1, green, done);
  col = col * (1.0 - inDisc) + discCol * discA * inDisc + glowCol * glow;
  alpha = alpha * (1.0 - inDisc) + discA * inDisc + glow;

  // Everything fades out before the canvas edge so loud rings can never be cropped square.
  float fade = 1.0 - smoothstep(limit * 0.85, limit * 0.98, r);
  col *= fade;
  alpha *= fade;

  float k = dark > 0.5 ? 1.0 : 0.85;
  float outA = clamp(alpha * k, 0.0, 1.0);
  return half4(half3(clamp(col * k, 0.0, 1.0)), half(outA));
}
`;

let voiceEffect: SkRuntimeEffect | null = null;
// Compiled on first use, not at import.
function voiceShader() {
  return (voiceEffect ??= Skia.RuntimeEffect.Make(VOICE_SKSL)!);
}

/**
 * Voice-entry orb: a solid disc for the mic icon in a ring of spectrum bars that wave gently at
 * rest, bounce with `level` (a shared value of speech volume, about -2..10) while listening, carry a sweeping crest
 * while thinking and settle green when saved. `discColor` is any CSS colour (usually the theme surface).
 */
export function VoiceOrb({
  size,
  mode,
  level,
  isDark,
  discColor,
}: {
  size: number;
  mode: VoiceOrbMode;
  level?: SharedValue<number>;
  isDark: boolean;
  discColor: string;
}) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const phase = useSharedValue(0);
  const volume = useSharedValue(0);
  const shownVolume = useSharedValue(0);
  const pending = useSharedValue(0);
  const listen = useSharedValue(mode === "listening" ? 1 : 0);
  const think = useSharedValue(mode === "thinking" ? 1 : 0);
  const done = useSharedValue(mode === "done" ? 1 : 0);

  useEffect(() => {
    listen.set(withTiming(mode === "listening" ? 1 : 0, { duration: 300 }));
    think.set(withTiming(mode === "thinking" ? 1 : 0, { duration: 350 }));
    done.set(withTiming(mode === "done" ? 1 : 0, { duration: 450 }));
  }, [done, listen, mode, think]);

  const listening = mode === "listening";
  useAnimatedReaction(
    () => (listening ? Math.min(1, Math.max(0, ((level?.get() ?? 0) + 2) / 12)) : 0),
    (normalized, previous) => {
      if (normalized !== previous) volume.set(withSpring(normalized, { damping: 12, stiffness: 180 }));
    },
    [listening, level],
  );

  const tickS = TICK_S[usePerfTier()];

  const clock = useFrameCallback((frame) => {
    const elapsed = pending.get() + (frame.timeSincePreviousFrame ?? 16) / 1000;
    if (elapsed < tickS) {
      pending.set(elapsed);
      return;
    }
    pending.set(0);
    const dt = Math.min(elapsed, 0.1);
    shownVolume.set(volume.get());
    phase.set((phase.get() + dt * (1 + volume.get() * 1.5)) % PHASE_WRAP);
  }, false);
  useEffect(() => {
    clock.setActive(appActive && !reduceMotion);
  }, [appActive, clock, reduceMotion]);

  const center = size / 2;
  const radius = size * DISC_RADIUS;
  const dark = isDark ? 1 : 0;
  const disc = Array.from(Skia.Color(discColor));

  const uniforms = useDerivedValue(() => ({
    center: [center, center],
    radius,
    limit: center / radius,
    phase: phase.get(),
    level: reduceMotion ? volume.get() : shownVolume.get(),
    listen: listen.get(),
    think: think.get(),
    done: done.get(),
    dark,
    disc,
    c1: C1,
    c2: C2,
    c3: C3,
    green: GREEN,
  }));

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Canvas style={{ width: size, height: size }}>
        <Rect x={0} y={0} width={size} height={size}>
          <Shader source={voiceShader()} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </View>
  );
}
