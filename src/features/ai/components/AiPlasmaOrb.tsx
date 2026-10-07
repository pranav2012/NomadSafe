import React, { useEffect } from "react";
import { View } from "react-native";
import { Canvas, Rect, Shader, Skia, type SkRuntimeEffect } from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { auraStatusColors } from "@/constants/aura";
import { useAppActive } from "@/hooks/useAnimationsActive";
import { lightImpact, mediumImpact, selectionChanged } from "@/utils/haptics";

export type AiPlasmaOrbMode = "idle" | "thinking";

const BLEED = 0.45;
const CONTAINED_BLEED = 0.18;
const TIME_OFFSET = 37;
const FLOW_WRAP = 2000;
const STIR_LIFETIME = 4;
const RIPPLE_LIFETIME = 3;
const MAX_TOUCH = 1.2;
const RIPPLE_SLOTS = 4;
const TRAIL_SLOTS = 6;
const TRAIL_STEP = 0.1;
const MAX_STIR_SPEED = 4;
const WAKE_DISTANCE = 0.2;
const TAP_SECONDS = 0.22;
const TAP_SLOP = 0.12;
const CHARGE_MS = 1400;
const WOBBLE = { damping: 5, stiffness: 190, mass: 0.7 };
const NO_SPLASH: [number, number, number] = [0, 0, 99];
const NO_RIPPLE = [0, 0, 99, 0];
const NO_TRAIL = [0, 0, 0, 0];
const NO_TRAIL_AGES_A = [99, 99, 99, 99];
const NO_TRAIL_AGES_B = [99, 99];
// The plasma drifts slowly, so its clock ticks at ~30 fps; touches still animate at the display rate.
const TICK_S = 0.033;

type Ripple = [x: number, y: number, start: number, amp: number];
type TrailPoint = [x: number, y: number, vx: number, vy: number, start: number];

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const [C1, C2, C3] = auraStatusColors.calm.map(hexToRgb);

// A disc of liquid light filled with domain-warped noise ("plasma") in the three aura colours, with a
// soft rim and a bloom that fades to nothing before `limit`. Thinking (`energy`) swells it and adds
// a flickering sun-like corona; holding (`charge`) swells and brightens it without the corona.
// Touch: up to four travelling ripples (x, y, age, amp) refract the plasma as they pass; `press`
// swirls the flow around `touch`; six stroke samples stir the colours like ink; `squeeze` (signed,
// springs past zero) gives the jelly squish; `splash` (x, y, age) is a tap: a ring of light shoots
// out while the colours scatter and reform.
const PLASMA_SKSL = `
uniform float2 center;
uniform float radius;
uniform float limit;
uniform float breath;
uniform float2 ringPhase;
uniform float flow;
uniform float coronaPhase;
uniform float rippleOn;
uniform float stirOn;
uniform float energy;
uniform float fill;
uniform float dark;
uniform float3 c1;
uniform float3 c2;
uniform float3 c3;
uniform float2 touch;
uniform float press;
uniform float charge;
uniform float squeeze;
uniform float2 squashDir;
uniform float4 rip0;
uniform float4 rip1;
uniform float4 rip2;
uniform float4 rip3;
uniform float3 splash;
uniform float4 tr0;
uniform float4 tr1;
uniform float4 tr2;
uniform float4 tr3;
uniform float4 tr4;
uniform float4 tr5;
uniform float4 trAgeA;
uniform float2 trAgeB;

// "Hash without sine": accurate on mobile GPUs as long as inputs stay small, which is why every
// animated offset below is bounded (periodic drift or a wrapping phase).
float2 hash2(float2 p) {
  float3 p3 = fract(float3(p.xyx) * float3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

// Gradient noise with a quintic fade: smooth, with no visible grid squares (unlike value noise).
float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i), f);
  float b = dot(hash2(i + float2(1.0, 0.0)), f - float2(1.0, 0.0));
  float c = dot(hash2(i + float2(0.0, 1.0)), f - float2(0.0, 1.0));
  float d = dot(hash2(i + float2(1.0, 1.0)), f - float2(1.0, 1.0));
  return 0.5 + 0.75 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Octaves are rotated as well as scaled so their lattices never line up.
float fbm3(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = float2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + float2(3.1, 1.7);
    a *= 0.5;
  }
  return v / 0.875;
}

float fbm4(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = float2(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + float2(3.1, 1.7);
    a *= 0.5;
  }
  return v / 0.9375;
}

float wave(float2 p, float4 rp) {
  float d = length(p - rp.xy);
  float front = rp.z * 1.5;
  float packet = exp(-pow((d - front) * 3.2, 2.0));
  return rp.w * packet * sin((d - front) * 20.0) * exp(-rp.z * 1.4);
}

float height(float2 p) {
  return wave(p, rip0) + wave(p, rip1) + wave(p, rip2) + wave(p, rip3);
}

// One stroke sample (x, y, vx, vy) stirring the liquid: colours are fetched from upstream so they
// get carried along the stroke, and an eddy curls on the side the finger passed, growing briefly
// after the stroke and then settling.
float2 stir(float2 p, float4 tp, float age) {
  float2 d = p - tp.xy;
  float near = exp(-dot(d, d) * 5.0);
  float2 v = tp.zw;
  float speed = length(v);
  float smear = exp(-age * 1.3);
  float curl = sign(v.x * d.y - v.y * d.x) * speed * (0.25 + age) * exp(-age * 1.1) * 0.55;
  return (-v * 0.2 * smear + float2(-d.y, d.x) * curl) * near;
}

half4 main(float2 xy) {
  float boost = max(charge, energy);
  float breathe = 1.0 + 0.022 * breath + boost * 0.05;
  float2 p = (xy - center) / (radius * breathe);
  float along = dot(p, squashDir);
  float2 perp = p - squashDir * along;
  p = squashDir * (along * (1.0 + squeeze) + squeeze * 0.15) + perp * (1.0 - squeeze * 0.5);
  float r = length(p);
  float aa = 1.5 / radius;
  float angle = atan(p.y, p.x);

  float splashAge = splash.z;
  float splashD = length(p - splash.xy);
  float splashRing = exp(-pow((splashD - splashAge * 2.4) * 9.0, 2.0)) * exp(-splashAge * 2.6);

  float3 ringColor = mix(mix(c1, c2, 0.5 + 0.5 * sin(angle + ringPhase.x)), c3, 0.5 + 0.5 * cos(angle * 2.0 - ringPhase.y));
  float halo = max(r - 1.0, 0.0);
  float glow = 0.75 + boost * 0.6;
  float bloom = (exp(-halo * 3.6) * 0.55 + exp(-halo * 12.0) * 0.35) * glow;
  bloom += splashRing * 0.8 * exp(-halo * 2.0);

  // Corona, only while thinking: noise sampled along each ray, scrolled so flame-like streaks
  // stream outward from the rim. Two copies half a cycle apart cross-fade so the scroll can wrap
  // without a jump.
  if (energy > 0.01 && r > 1.0 - aa) {
    float2 dir = p / max(r, 0.0001);
    float ph1 = fract(coronaPhase);
    float ph2 = fract(coronaPhase + 0.5);
    float w = abs(ph1 * 2.0 - 1.0);
    float s1 = fbm3(dir * (3.0 + (halo * 2.2 - ph1 * 2.0) * 1.2) + float2(0.0, 7.0));
    float s2 = fbm3(dir * (3.0 + (halo * 2.2 - ph2 * 2.0) * 1.2) + float2(5.0, 1.0));
    float rays = noise(dir * 6.0 + float2(sin(flow * 0.3), cos(flow * 0.23)) * 1.5);
    float reach = (0.2 + 0.3 * noise(dir * 2.0 + float2(cos(flow * 0.2), sin(flow * 0.17)))) * (1.0 + energy * 0.8);
    float corona = pow(smoothstep(0.35, 0.85, mix(s1, s2, w) * 0.6 + rays * 0.5), 1.5) * exp(-halo / reach) * step(1.0, r);
    bloom += corona * energy * 1.15;
  }
  bloom *= (dark > 0.5 ? 1.0 : 0.65) * (1.0 - smoothstep(mix(1.0, limit, 0.35), limit, r));
  half4 outside = half4(half3(ringColor * bloom), half(bloom));
  if (r > 1.0 + aa) return outside;

  float td = length(p - touch);
  float dent = press * exp(-td * td * 7.0);
  float h = 0.0;
  float2 grad = float2(0.0);
  if (rippleOn > 0.5) {
    h = height(p);
    grad = float2(height(p + float2(0.01, 0.0)) - h, height(p + float2(0.0, 0.01)) - h) / 0.01;
  }

  // Swirl the flow around the finger, stir it along recent strokes, refract it through the
  // ripples and scatter it after a tap. Flat (no sphere bend) so it reads as liquid, not a ball.
  float2 dv = p - touch;
  float sw = dent * 2.4;
  float2 pr = touch + float2(dv.x * cos(sw) - dv.y * sin(sw), dv.x * sin(sw) + dv.y * cos(sw));
  pr += grad * 0.05;
  pr += (p - splash.xy) * exp(-splashAge * 3.0) * 0.9;
  if (stirOn > 0.5) {
    pr += stir(p, tr0, trAgeA.x) + stir(p, tr1, trAgeA.y) + stir(p, tr2, trAgeA.z)
        + stir(p, tr3, trAgeA.w) + stir(p, tr4, trAgeB.x) + stir(p, tr5, trAgeB.y);
  }
  // Drift along slow, bounded loops so noise inputs never grow large.
  float2 q = pr * 1.25;
  float2 o1 = float2(sin(flow * 0.53), cos(flow * 0.41)) * 2.2;
  float2 o2 = float2(cos(flow * 0.37 + 1.0), sin(flow * 0.47 + 2.0)) * 2.2;
  float2 o3 = float2(sin(flow * 0.29 + 3.0), cos(flow * 0.33 + 0.5)) * 1.8;
  float2 warp = float2(fbm3(q * 1.6 + o1), fbm3(q * 1.6 + o2 + 5.2));
  float f = fbm4(q * 2.2 + warp * 2.4 + o3);
  float g = fbm3(q * 3.1 - warp * 1.7 - o1 * 0.6 + 11.0);

  float3 col = mix(c1, c2, smoothstep(0.25, 0.75, f));
  col = mix(col, c3, smoothstep(0.35, 0.8, g));
  float veins = pow(smoothstep(0.45, 0.95, f * g * 1.9), 2.0);
  col = mix(col, mix(c2, c3, 0.5) * 1.25, veins * 0.6);

  col *= 0.92 + boost * 0.25;
  col += ringColor * smoothstep(0.82, 1.0, r) * (0.18 + boost * 0.35);
  col += ringColor * (splashRing * 0.9 + abs(h) * 0.35 + dent * 0.25);

  // Fill level (onboarding download): liquid below a wavy surface line, a dark empty orb above it.
  if (fill >= 0.0) {
    float level = 1.05 - 2.1 * fill + 0.035 * sin(p.x * 7.0 + flow * 3.0) + 0.02 * sin(p.x * 13.0 - flow * 4.1);
    float wet = smoothstep(-aa, aa, p.y - level);
    float surface = exp(-pow((p.y - level) * radius / 1.5, 2.0)) * step(0.001, fill) * step(fill, 0.999);
    float3 empty = col * 0.1 + ringColor * smoothstep(0.85, 1.0, r) * 0.25;
    col = mix(empty, col, wet) + ringColor * surface * 0.8;
  }

  float edge = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  half4 sphere = half4(half3(clamp(col, 0.0, 1.0)), 1.0);
  return mix(outside, sphere, half(edge));
}
`;

let plasma: SkRuntimeEffect | null = null;
// Compiled on first use, not at import.
function plasmaEffect() {
  return (plasma ??= Skia.RuntimeEffect.Make(PLASMA_SKSL)!);
}

/**
 * The AI tab's orb: a GPU-shaded plasma sphere that breathes when idle and swells with a sun-like corona while
 * `thinking`. With `interactive`, a finger dents it and sends ripples across it, a tap splashes,
 * holding charges it up, and it wobbles back on release. `contained` keeps the glow inside the
 * component's own box (for small orbs whose parents would clip it). Pass `paused` when offscreen.
 */
export function AiPlasmaOrb({
  size,
  mode,
  isDark,
  paused = false,
  interactive = false,
  contained = false,
  fill,
}: {
  size: number;
  mode: AiPlasmaOrbMode;
  isDark: boolean;
  paused?: boolean;
  interactive?: boolean;
  contained?: boolean;
  /** 0..1 liquid level (e.g. download progress); omit for a full orb. */
  fill?: number;
}) {
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const time = useSharedValue(TIME_OFFSET);
  const flow = useSharedValue(TIME_OFFSET);
  const coronaPhase = useSharedValue(0);
  const energy = useSharedValue(mode === "thinking" ? 1 : 0);
  const level = useSharedValue(fill ?? 1);
  const hasFill = fill !== undefined;
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const press = useSharedValue(0);
  const charge = useSharedValue(0);
  const squeeze = useSharedValue(0);
  const dirX = useSharedValue(0);
  const dirY = useSharedValue(1);
  const ripples = useSharedValue<Ripple[]>([]);
  const trail = useSharedValue<TrailPoint[]>([]);
  const splash = useSharedValue<[number, number, number]>([0, 0, -99]);
  const wake = useSharedValue<[number, number]>([0, 0]);
  const down = useSharedValue<[number, number, number]>([0, 0, 0]);
  const moved = useSharedValue(false);
  const pending = useSharedValue(0);

  useEffect(() => {
    energy.set(withTiming(mode === "thinking" ? 1 : 0, { duration: 700 }));
  }, [energy, mode]);

  useEffect(() => {
    if (fill !== undefined) level.set(withTiming(Math.min(1, Math.max(0, fill)), { duration: 600 }));
  }, [fill, level]);

  // Flow and corona phases advance faster while boosted; integrating them (instead of scaling
  // time) keeps speed changes smooth, and wrapping keeps the shader's inputs small.
  const clock = useFrameCallback((frame) => {
    const elapsed = pending.get() + (frame.timeSincePreviousFrame ?? 16) / 1000;
    if (elapsed < TICK_S) {
      pending.set(elapsed);
      return;
    }
    pending.set(0);
    const dt = Math.min(elapsed, 0.1);
    const boost = Math.max(charge.get(), energy.get());
    time.set(time.get() + dt);
    flow.set((flow.get() + dt * (0.25 + boost * 0.2)) % FLOW_WRAP);
    coronaPhase.set((coronaPhase.get() + dt * (0.35 + energy.get() * 0.5)) % 1);
  }, false);
  useEffect(() => {
    clock.setActive(appActive && !paused && !reduceMotion);
  }, [appActive, clock, paused, reduceMotion]);

  const bleed = size * (contained ? CONTAINED_BLEED : BLEED);
  const canvas = size + bleed * 2;
  const center = canvas / 2;
  const radius = size / 2;
  const dark = isDark ? 1 : 0;

  const addRipple = (x: number, y: number, amp: number) => {
    "worklet";
    const next = [...ripples.get(), [x, y, time.get(), amp] as Ripple];
    ripples.set(next.slice(-RIPPLE_SLOTS));
  };

  const addTrail = (vx: number, vy: number) => {
    "worklet";
    const last = trail.get()[trail.get().length - 1];
    const x = touchX.get();
    const y = touchY.get();
    if (last && time.get() - last[4] < 1.5 && Math.hypot(x - last[0], y - last[1]) < TRAIL_STEP) return;
    const speed = Math.hypot(vx, vy);
    const scale = speed > MAX_STIR_SPEED ? MAX_STIR_SPEED / speed : 1;
    const next = [...trail.get(), [x, y, vx * scale, vy * scale, time.get()] as TrailPoint];
    trail.set(next.slice(-TRAIL_SLOTS));
  };

  const moveTo = (x: number, y: number) => {
    "worklet";
    let tx = (x - size / 2) / radius;
    let ty = (y - size / 2) / radius;
    const len = Math.hypot(tx, ty);
    if (len > MAX_TOUCH) {
      tx = (tx / len) * MAX_TOUCH;
      ty = (ty / len) * MAX_TOUCH;
    }
    touchX.set(tx);
    touchY.set(ty);
    if (len > 0.05) {
      dirX.set(tx / len);
      dirY.set(ty / len);
    }
    squeeze.set(withSpring(0.05 + 0.07 * Math.min(len, 1), { damping: 16, stiffness: 320 }));
  };

  const touchGesture = Gesture.Pan()
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .hitSlop(size * 0.15)
    .onBegin((event) => {
      moveTo(event.x, event.y);
      down.set([touchX.get(), touchY.get(), time.get()]);
      wake.set([touchX.get(), touchY.get()]);
      moved.set(false);
      addRipple(touchX.get(), touchY.get(), 0.9);
      press.set(withSpring(1, { damping: 18, stiffness: 340 }));
      charge.set(withTiming(1, { duration: CHARGE_MS }));
      scheduleOnRN(lightImpact);
    })
    .onUpdate((event) => {
      moveTo(event.x, event.y);
      addTrail(event.velocityX / radius, event.velocityY / radius);
      const [sx, sy] = down.get();
      if (Math.hypot(touchX.get() - sx, touchY.get() - sy) > TAP_SLOP) moved.set(true);
      const [wx, wy] = wake.get();
      if (Math.hypot(touchX.get() - wx, touchY.get() - wy) > WAKE_DISTANCE) {
        wake.set([touchX.get(), touchY.get()]);
        addRipple(touchX.get(), touchY.get(), 0.55);
        scheduleOnRN(selectionChanged);
      }
    })
    .onFinalize(() => {
      const tapped = !moved.get() && time.get() - down.get()[2] < TAP_SECONDS;
      if (tapped) {
        splash.set([touchX.get(), touchY.get(), time.get()]);
        scheduleOnRN(mediumImpact);
      } else {
        addRipple(touchX.get(), touchY.get(), 0.7);
        scheduleOnRN(lightImpact);
      }
      press.set(withTiming(0, { duration: 320 }));
      charge.set(withTiming(0, { duration: 700 }));
      squeeze.set(withSpring(0, WOBBLE));
    });

  const centerVec = [center, center];
  // Idle frames reuse constant arrays for the touch uniforms instead of allocating ~16 per frame.
  const uniforms = useDerivedValue(() => {
    const now = time.get();
    const list = ripples.get();
    const rip = (i: number) => {
      const item = list[i];
      return item ? [item[0], item[1], now - item[2], item[3]] : NO_RIPPLE;
    };
    const [sx, sy, start] = splash.get();
    const strokes = trail.get();
    const tr = (i: number) => {
      const item = strokes[i];
      return item ? [item[0], item[1], item[2], item[3]] : NO_TRAIL;
    };
    const trAge = (i: number) => {
      const item = strokes[i];
      return item ? now - item[4] : 99;
    };
    return {
      center: centerVec,
      radius,
      limit: center / radius,
      breath: Math.sin(now * 1.3),
      ringPhase: [(now * 0.7) % (Math.PI * 2), (now * 0.5) % (Math.PI * 2)],
      flow: flow.get(),
      coronaPhase: coronaPhase.get(),
      rippleOn: list.some((item) => now - item[2] < RIPPLE_LIFETIME) ? 1 : 0,
      stirOn: strokes.some((item) => now - item[4] < STIR_LIFETIME) ? 1 : 0,
      energy: energy.get(),
      fill: hasFill ? level.get() : -1,
      dark,
      c1: C1,
      c2: C2,
      c3: C3,
      touch: [touchX.get(), touchY.get()],
      press: press.get(),
      charge: charge.get(),
      squeeze: squeeze.get(),
      squashDir: [dirX.get(), dirY.get()],
      rip0: rip(0),
      rip1: rip(1),
      rip2: rip(2),
      rip3: rip(3),
      tr0: tr(0),
      tr1: tr(1),
      tr2: tr(2),
      tr3: tr(3),
      tr4: tr(4),
      tr5: tr(5),
      trAgeA: strokes.length ? [trAge(0), trAge(1), trAge(2), trAge(3)] : NO_TRAIL_AGES_A,
      trAgeB: strokes.length > 4 ? [trAge(4), trAge(5)] : NO_TRAIL_AGES_B,
      splash: start < 0 ? NO_SPLASH : [sx, sy, now - start],
    };
  });

  const canvasStyle = contained
    ? { width: canvas, height: canvas }
    : { position: "absolute" as const, left: -bleed, top: -bleed, width: canvas, height: canvas };
  const box = contained ? canvas : size;

  const orb = (
    <View style={{ width: box, height: box }} pointerEvents={interactive ? "auto" : "none"}>
      <Canvas style={canvasStyle} pointerEvents="none">
        <Rect x={0} y={0} width={canvas} height={canvas}>
          <Shader source={plasmaEffect()} uniforms={uniforms} />
        </Rect>
      </Canvas>
    </View>
  );

  return interactive ? <GestureDetector gesture={touchGesture}>{orb}</GestureDetector> : orb;
}
