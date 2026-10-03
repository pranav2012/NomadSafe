import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Canvas, Fill, Shader, Skia } from "react-native-skia";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import {
  Easing,
  SensorType,
  useAnimatedSensor,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export const SKY_INTRO_MS = 2800;

let introPlayed = false;

/** True the first time it's called in an app session, so the intro plays once per launch. */
export function consumeSkyIntro() {
  if (introPlayed) return false;
  introPlayed = true;
  return true;
}

// Northern-lights landscape mirrored in a lake. Coordinates are in sky-height units
// (p.y 0 = top of sky, 1 = bottom of the hero); `tilt` shifts each depth layer for parallax
// and `intro` (0..1) fades the sky up from black and sweeps the aurora up from the horizon.
const SKY = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float top;
uniform float time;
uniform float dark;
uniform float intro;
uniform float2 tilt;

const float WATER = 0.68;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

float fbm3(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

float fbm5(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 31.0; a *= 0.5; }
  return v;
}

float ribbonEdge(float x, float base, float amp, float seed) {
  return base + amp * sin(x * 3.0 + time * 0.08 + seed) + amp * 0.5 * sin(x * 6.5 - time * 0.13 + seed * 1.7)
    + 0.08 * (fbm3(float2(x * 1.5 + time * 0.02, seed)) - 0.5);
}

// A soft aurora band as photographed: a broad glow rising from a soft lower edge, brightness in
// drifting patches along the band, faint ray texture, green turning violet near the top.
float3 band(float2 p, float base, float amp, float seed, float height) {
  float x = p.x;
  float d = ribbonEdge(x, base, amp, seed) - p.y;
  float rayH = height * (0.7 + 0.6 * noise(float2(x * 2.0 + seed, time * 0.05)));
  float body = d > 0.0 ? exp(-d / rayH) : exp(d * 10.0);
  float patches = smoothstep(0.25, 0.75, fbm3(float2(x * 2.2 - time * 0.06, seed + time * 0.03)));
  float texture = 0.85 + 0.15 * noise(float2(x * 30.0 + time * 0.4, seed));
  float h = max(d, 0.0) / rayH;
  float3 col = mix(float3(0.32, 1.0, 0.42), float3(0.2, 0.9, 0.55), smoothstep(0.3, 1.2, h));
  col = mix(col, float3(0.55, 0.3, 0.75), smoothstep(1.2, 2.6, h));
  float glow = 0.03 * exp(-abs(d) * 4.0);
  return col * (body * (0.04 + 1.3 * patches * patches) * texture + glow * patches);
}

// A tall plume leaning across the sky, like the bright pillar in long-exposure photos.
float3 plume(float2 p, float seed) {
  float cx = 0.18 + 0.05 * sin(time * 0.05 + seed) + (0.5 - p.y) * 0.35;
  float w = 0.06 + 0.05 * p.y;
  float across = (p.x - cx) / w;
  float shape = exp(-across * across) * smoothstep(0.02, 0.3, p.y) * (1.0 - smoothstep(0.55, 0.68, p.y));
  float streak = 0.75 + 0.25 * noise(float2(p.x * 22.0 + time * 0.3, p.y * 2.0));
  float drift = 0.6 + 0.4 * fbm3(float2(p.y * 3.0 - time * 0.08, seed));
  return float3(0.3, 1.0, 0.45) * shape * streak * drift * 0.9;
}

float3 aurora(float2 p) {
  float3 a = 1.15 * band(p, WATER - 0.09, 0.05, 0.0, 0.24) + 0.5 * band(p, WATER - 0.26, 0.05, 4.0, 0.2) + 0.15 * band(p, WATER - 0.42, 0.05, 9.0, 0.14);
  a += 0.55 * plume(p, 2.0);
  a += float3(0.2, 0.8, 0.45) * 0.03 * exp(-max(WATER - 0.04 - p.y, 0.0) * 5.0);
  return a;
}

// A row of snow-laden spruces standing on the base line: each tree is stacked branch tiers that widen
// downward, with a little snow on top of every tier. Returns (coverage, snow).
float2 spruces(float2 p, float spacing, float hMin, float hMax, float base, float seed, float density) {
  float cell = floor(p.x / spacing);
  float2 hit = float2(0.0);
  for (int k = -1; k <= 1; k++) {
    float c = cell + float(k);
    float cx = (c + 0.25 + 0.5 * hash(float2(c, seed))) * spacing;
    float h = mix(hMin, hMax, pow(hash(float2(c, seed + 1.0)), 1.5)) * step(1.0 - density, hash(float2(c, seed + 3.0)));
    float rel = (p.y - (base - h)) / h;
    if (h > 0.0 && rel > 0.0 && rel < 1.0) {
      float tiers = 8.0 + floor(hash(float2(c, seed + 2.0)) * 5.0);
      float tier = floor(rel * tiers);
      float f = fract(rel * tiers);
      float ragged = 0.8 + 0.4 * hash(float2(c * 13.0 + tier, seed + sign(p.x - cx)));
      float halfW = h * 0.21 * pow(rel, 0.9) * (0.72 + 0.28 * f) * ragged + h * 0.008;
      float cover = smoothstep(halfW, halfW - 1.5 / res.y, abs(p.x - cx));
      if (cover > hit.x) hit = float2(cover, pow(1.0 - f, 3.0) * smoothstep(0.1, 0.3, rel) * smoothstep(0.3, -0.6, (p.x - cx) / halfW) * 0.5);
    }
  }
  return hit;
}

float ridge1(float x, float seed) {
  float v = 0.0;
  float a = 0.5;
  float f = 1.0;
  float prev = 1.0;
  for (int i = 0; i < 5; i++) {
    float n = 1.0 - abs(noise(float2(x * f, seed)) * 2.0 - 1.0);
    n *= n;
    v += n * a * prev;
    prev = n;
    f *= 2.1;
    a *= 0.5;
  }
  return v;
}

float3 scene(float2 p, float stars) {
  float lit = smoothstep(0.0, 0.3, intro);
  float2 ps = p + tilt * 0.015;

  float3 skyTop = mix(float3(0.12, 0.13, 0.3), float3(0.006, 0.012, 0.035), dark);
  float3 skyLow = mix(float3(0.62, 0.48, 0.62), float3(0.02, 0.045, 0.1), dark);
  float3 col = mix(skyTop, skyLow, smoothstep(0.0, WATER, p.y)) * lit;

  float across = dot(ps - float2(0.55, 0.25), normalize(float2(0.55, 1.0)));
  float band = exp(-across * across * 26.0) * (1.0 - smoothstep(0.35, 0.62, p.y));
  float dust = smoothstep(0.38, 0.75, fbm5(ps * 5.0));
  col += band * (0.15 + 0.85 * dust) * float3(0.5, 0.55, 0.85) * mix(0.1, 0.16, dark) * smoothstep(0.1, 0.5, intro);

  float2 cell = ps * 70.0;
  float h = hash(floor(cell));
  float twinkle = 0.55 + 0.45 * sin(time * (1.5 + h * 2.0) + h * 60.0);
  float star = step(0.972 - band * 0.04, h) * smoothstep(0.22, 0.0, length(fract(cell) - 0.5)) * twinkle;
  col += stars * star * (1.0 - smoothstep(0.45, 0.7, p.y)) * mix(0.45, 1.0, dark) * smoothstep(0.05, 0.35, intro);

  float period = 7.0;
  float idx = floor(time / period);
  float ph = fract(time / period) * 4.0;
  if (ph < 1.0 && intro > 0.99) {
    float2 start = float2(0.1 + hash(float2(idx, 1.0)) * 0.6, 0.04 + hash(float2(idx, 2.0)) * 0.14);
    float2 dir = normalize(float2(1.0, 0.42));
    float2 rel = ps - (start + dir * ph * 0.5);
    float along = clamp(dot(rel, -dir), 0.0, 0.18);
    float trail = smoothstep(0.004, 0.0, length(rel + dir * along)) * (1.0 - along / 0.18) * sin(3.1416 * ph);
    col += trail * float3(0.9, 0.95, 1.0);
  }

  float front = mix(-0.1, 0.9, smoothstep(0.2, 0.92, intro));
  float rise = WATER - p.y;
  float reveal = 1.0 - smoothstep(front - 0.2, front, rise);
  float sweep = exp(-pow((rise - front) * 8.0, 2.0)) * (1.0 - smoothstep(0.85, 1.0, intro));
  float3 aur = aurora(ps) * reveal * (1.0 + 1.5 * sweep);
  aur = mix(aur, float3(dot(aur, float3(0.3, 0.55, 0.15))), 0.25) * 0.95;
  col += aur * mix(0.75, 1.0, dark);

  float aa = 1.5 / res.y;
  float3 auraTint = float3(0.3, 0.95, 0.65) * smoothstep(0.3, 0.9, intro);

  float2 pf = p + tilt * float2(0.03, 0.008);
  float ridge = WATER - 0.025 - 0.085 * ridge1(pf.x * 2.2 + 2.0, 3.0) - 0.012 * fbm3(float2(pf.x * 12.0, 1.0));
  float slope = ridge1(pf.x * 2.2 + 2.012, 3.0) - ridge1(pf.x * 2.2 + 1.988, 3.0);
  float face = mix(0.8, 1.0, smoothstep(-0.01, 0.01, slope));
  float3 snowLit = mix(float3(0.42, 0.4, 0.55), float3(0.07, 0.1, 0.13), dark) + auraTint * 0.05;
  float3 mtn = snowLit * face * (1.0 - smoothstep(0.0, 0.06, pf.y - ridge) * 0.45) * (0.95 + 0.1 * fbm3(pf * float2(30.0, 60.0)));
  mtn = mix(mtn, skyLow, 0.25) * lit;
  col = mix(col, mtn, smoothstep(ridge - aa, ridge + aa, pf.y));

  float3 treeDark = mix(float3(0.1, 0.09, 0.18), float3(0.006, 0.01, 0.018), dark);
  float3 treeSnow = mix(float3(0.4, 0.38, 0.52), float3(0.08, 0.11, 0.14), dark) + auraTint * 0.04;

  float2 pb = p + tilt * float2(0.04, 0.011);
  float2 far2 = spruces(pb, 0.006, 0.01, 0.022, WATER - 0.006, 11.0, 0.9);
  col = mix(col, mix(mix(treeDark, treeSnow, far2.y * 0.5), skyLow, 0.35) * lit, far2.x);

  float2 pm = p + tilt * float2(0.05, 0.013);
  float2 mid = spruces(pm, 0.012, 0.018, 0.042, WATER - 0.002, 17.0, 0.75);
  col = mix(col, mix(mix(treeDark, treeSnow, mid.y * 0.6), skyLow, 0.15) * lit, mid.x);

  float2 pn = p + tilt * float2(0.065, 0.017);
  float2 near2 = spruces(pn, 0.03, 0.04, 0.085, WATER + 0.002, 23.0, 0.45);
  col = mix(col, mix(treeDark, treeSnow, near2.y * 0.7) * lit, near2.x);

  return col;
}

half4 main(float2 xy) {
  float skyH = res.y - top;
  float2 p = float2(xy.x / skyH, (xy.y - top) / skyH);
  float3 col;
  if (p.y < WATER) {
    col = scene(p, 1.0);
  } else {
    // Calm water: ripple slopes from 2D noise laid out on the lake plane (finer toward the horizon)
    // nudge a vertically blurred mirror image; Fresnel makes the far water more mirror-like.
    float depth = p.y - WATER;
    float z = 1.0 / (depth + 0.03);
    float2 lake = float2(p.x * z * 0.9, z * 2.2) + float2(time * 0.04, time * 0.18);
    float r0 = fbm3(lake);
    float rx = fbm3(lake + float2(0.05, 0.0)) - r0;
    float ry = fbm3(lake + float2(0.0, 0.05)) - r0;
    float amp = 0.02 * (0.15 + depth * 4.0);
    float2 q = float2(p.x + rx * amp, 2.0 * WATER - p.y + ry * amp * 0.6);
    float blur = 0.003 + depth * 0.03;
    float3 refl = (scene(q, 0.0) + scene(q - float2(0.0, blur), 0.0) + scene(q + float2(0.0, blur), 0.0)) / 3.0;
    refl *= 0.9 + 0.25 * clamp(ry * 12.0, -0.6, 0.6);
    float3 water = mix(float3(0.12, 0.11, 0.2), float3(0.004, 0.008, 0.016), dark) * smoothstep(0.0, 0.3, intro);
    float reflectivity = mix(0.88, 0.45, smoothstep(0.0, 0.3, depth));
    col = mix(water, refl * 0.82, reflectivity);
  }
  float drift = fbm3(float2(p.x * 3.0 - time * 0.03, p.y * 18.0 + time * 0.02));
  float mist = exp(-abs(p.y - WATER + 0.006) * 40.0) * smoothstep(0.35, 0.8, drift) * 0.18 * smoothstep(0.4, 1.0, intro);
  col = mix(col, mix(float3(0.45, 0.42, 0.55), float3(0.07, 0.12, 0.14), dark), mist);
  return half4(half3(1.0 - exp(-col * 1.25)), 1.0);
}
`)!;

const TILT_RANGE = 0.25;
// The aurora moves slowly; redrawing the full-screen shader at ~30 fps instead of 60–120 halves its cost.
const SKY_TICK_S = 0.033;

/** Sign-in/onboarding hero: an animated northern-lights landscape with tilt parallax and an optional intro. */
export function AuraSkyHero({
  width,
  height,
  topInset = 0,
  isDark,
  intro = false,
}: {
  width: number;
  height: number;
  topInset?: number;
  isDark: boolean;
  intro?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const clock = useSharedValue(reduceMotion ? 14 : 0);
  const reveal = useSharedValue(intro && !reduceMotion ? 0 : 1);
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const base = useSharedValue<{ x: number; y: number } | null>(null);
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const animating = useAnimationsActive();
  const elapsed = useSharedValue(0);

  useEffect(() => {
    if (reveal.get() < 1) reveal.set(withTiming(1, { duration: SKY_INTRO_MS, easing: Easing.inOut(Easing.cubic) }));
  }, [reveal]);

  const ticker = useFrameCallback((frame) => {
    elapsed.set(elapsed.get() + (frame.timeSincePreviousFrame ?? 16) / 1000);
    if (elapsed.get() < SKY_TICK_S) return;
    const dt = Math.min(elapsed.get(), 0.1);
    elapsed.set(0);
    clock.set(clock.get() + dt);
    const g = gravity.sensor.get();
    const len = Math.hypot(g.x, g.y, g.z) || 1;
    const gx = g.x / len;
    const gy = g.y / len;
    // Tilt is measured against a baseline that drifts toward the current pose, so any holding angle reads as neutral.
    const b = base.get() ?? { x: gx, y: gy };
    const drift = Math.min(1, dt * 0.4);
    base.set({ x: b.x + (gx - b.x) * drift, y: b.y + (gy - b.y) * drift });
    const tx = Math.max(-1, Math.min(1, (gx - b.x) / TILT_RANGE));
    const ty = Math.max(-1, Math.min(1, (gy - b.y) / TILT_RANGE));
    const k = Math.min(1, dt * 4);
    tiltX.set(tiltX.get() + (tx - tiltX.get()) * k);
    tiltY.set(tiltY.get() + (ty - tiltY.get()) * k);
  }, false);
  useEffect(() => {
    ticker.setActive(animating && !reduceMotion);
  }, [animating, reduceMotion, ticker]);

  const uniforms = useDerivedValue(() => ({
    res: [width, height],
    top: topInset,
    time: clock.get(),
    dark: isDark ? 1 : 0,
    intro: reveal.get(),
    tilt: [tiltX.get(), tiltY.get()],
  }));

  return (
    <View style={{ width, height }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={SKY} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}
