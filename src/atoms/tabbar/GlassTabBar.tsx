import React, { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PixelRatio, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import {
  Canvas,
  Fill,
  Group,
  ImageShader,
  LinearGradient,
  Paragraph,
  Path,
  RoundedRect,
  Shader,
  Skia,
  TextAlign,
  drawAsImage,
  useFonts,
  vec,
  type SkImage,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  type WithSpringConfig,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { TAB_ICONS, type TabIconName } from "./tabIcons";
import { TAB_BAR_HEIGHT, tabBarScale } from "./tabBarInset";
import { GlassSurface } from "./GlassSurface";

export interface GlassTabItem {
  key: string;
  label: string;
  icon: TabIconName;
}

interface GlassTabBarProps {
  items: GlassTabItem[];
  activeIndex: number;
  onChange: (index: number) => void;
  isDark: boolean;
  activeColor: string;
  inactiveColor: string;
  /** `require()`d font file for the labels; Skia shapes them itself. */
  labelFontSource: number;
  /** Android only: the BlurTargetView wrapping the content the bar floats over. */
  blurTarget?: RefObject<View | null>;
  style?: StyleProp<ViewStyle>;
}

// Room around the bar for the droplet to swell, stretch and overshoot past it.
const BLEED = 48;
// Lifted droplet, matched to iOS 26 recordings: ~1.35x a tab wide and ~1.13x the (pressed) bar tall.
// Bar metrics below are at the 402 dp reference width; tabBarScale() shrinks them on narrower screens.
const GROW_X = 0.36;
const GROW_Y = 0.32;
// As on iOS 26, the whole bar swells ~5% and brightens a little while it's held.
const PRESS_SCALE = 0.05;
const PRESS_IN: WithSpringConfig = { stiffness: 1000, damping: 58, mass: 1 };
const PRESS_OUT: WithSpringConfig = { stiffness: 700, damping: 45, mass: 1 };
// The drop follows its goal (the finger's travel, or a tab) through an underdamped spring
// (units: dp and ms). It trails a moving finger by ~2*ZETA/OMEGA (~52 ms), catches up quickly when
// the finger stops and swings a few dp past the bar's ends after a fast flick.
const FOLLOW_OMEGA = 0.027;
const FOLLOW_ZETA = 0.7;
const STEP_MS = 4;
// How far (dp, at the reference width) the drop may swing past the first or last tab. Past an end
// a stiffer, bouncier spring takes over, so a flick's momentum shows as a short bounce off the end.
const END_GIVE = 5;
const END_OMEGA = 0.08;
const END_ZETA = 0.5;
// While dragging into an end, the goal is carried past it by the drop's momentum (ms of travel).
const END_CARRY_MS = 6;
// Speed shaping, matched to iOS 26, driven by the drop's own speed (dp/ms): it stays fully lifted
// below FLATTEN_FROM, is squashed to exactly the bar's height by FLATTEN_TO and stretches a little
// wider when very fast. The flatten amount follows an underdamped spring, so when the drop slows
// down or lands it springs back taller than at rest and wobbles once (~0.45 s per cycle).
const FLATTEN_FROM = 0.18;
const FLATTEN_TO = 0.55;
const FLAT_OMEGA = 0.014;
const FLAT_ZETA = 0.3;
// Slowing down also kicks the flatten spring toward tall (per dp/ms of speed lost), so a stop
// rebounds visibly even from a speed that barely flattened the drop. The rebound is capped so a
// hard landing can't balloon it.
const DECEL_KICK = 0.024;
const TALL_MAX = 0.5;
// Taller than at rest also makes it a little narrower, and flattened a little wider.
const WOBBLE_X = 0.12;
const STRETCH_FROM = 0.8;
const STRETCH_TO = 1.6;
const STRETCH = 0.06;
const MORPH_OMEGA = 0.04;
// At full speed the trailing end lags this far (dp) behind, so the drop reads longer behind itself.
const TRAIL = 10;
const FULL_SPEED = 2.2;
const LIFT_IN: WithSpringConfig = { stiffness: 600, damping: 42, mass: 1 };
const LIFT_OUT: WithSpringConfig = { stiffness: 1600, damping: 80, mass: 1 };
// A quick tap keeps the drop up for at least this long (ms from the press), so it visibly travels
// and lands before it settles back into the pill, as on iOS.
const MIN_LIFT_MS = 300;
const REST_HANDOFF = 0.35;
// Finger travel (dp) before a press turns into a drag, so a tap's jitter doesn't nudge the drop.
const DRAG_SLOP = 6;
const ICON_SHADOW_DARK = "rgba(0,0,0,0.45)";
const ICON_SHADOW_LIGHT = "rgba(255,255,255,0.75)";
const BASE_INSET = 5;
const BASE_ICON = 22;
const BASE_LABEL = 10.5;
const BASE_ICON_Y = 11;
const BASE_LABEL_Y = 38;
// Only the outer rim of the drop bends light; how far (dp) it pushes at the very edge.
const RIM_BEND = 16;
const PD = PixelRatio.get();
// Aura page backgrounds (premultiplied RGBA), shown inside the drop where it looks past the bar.
const PAGE_DARK = premultiplied("#0B0D12", 1);
const PAGE_LIGHT = premultiplied("#F3F4F7", 1);
// The selected tab's pill tint at rest (premultiplied RGBA).
const PILL_DARK = premultiplied("#FFFFFF", 0.12);
const PILL_LIGHT = premultiplied("#0E1018", 0.06);

function smoothstep(from: number, to: number, value: number): number {
  "worklet";
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

function premultiplied(hex: string, alpha: number): number[] {
  const channel = (i: number) => (parseInt(hex.slice(i, i + 2), 16) / 255) * alpha;
  return [channel(1), channel(3), channel(5), alpha];
}
const RIM_DARK = ["rgba(255,255,255,0.3)", "rgba(255,255,255,0.05)", "rgba(255,255,255,0.05)", "rgba(255,255,255,0.18)"];
const RIM_LIGHT = ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.3)", "rgba(255,255,255,0.3)", "rgba(255,255,255,0.8)"];


// The droplet lens. The tab rows are rendered once into two images (plain and selected, device
// pixels); per frame this one shader composes them (selected inside the drop and the rest tab's
// cell, plain elsewhere, over the rest pill and press glow) and bends that composite inside the
// drop. Coordinates arrive in device pixels; geometry uniforms are in dp.
const LENS = Skia.RuntimeEffect.Make(`
uniform shader plainRow;
uniform shader selectedRow;
uniform float pd;
uniform float2 center;
uniform float2 halfSize;
uniform float lift;
uniform float band;
uniform float distortion;
uniform float chroma;
uniform float4 body;
uniform float rim;
uniform float motion;
uniform float2 barCenter;
uniform float2 barHalf;
uniform float4 page;
uniform float flatten;
uniform float2 restCell;
uniform float4 pill;
uniform float4 pillColor;
uniform float glow;

float sdCapsule(float2 p, float2 b) {
  float r = min(b.x, b.y);
  float2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

half4 content(float2 p) {
  float2 xy = p * pd;
  float inDrop = lift > 0.01 ? smoothstep(0.5, -0.5, sdCapsule(p - center, halfSize)) : 0.0;
  float inRest = step(restCell.x, p.x) * step(p.x, restCell.y);
  half4 row = mix(plainRow.eval(xy), selectedRow.eval(xy), half(max(inDrop, inRest)));
  half4 under = half4(pillColor) * half(smoothstep(0.5, -0.5, sdCapsule(p - pill.xy, pill.zw)));
  under += half4(glow) * half(smoothstep(0.5, -0.5, sdCapsule(p - barCenter, barHalf))) * (1.0 - under.a);
  return row + under * (1.0 - row.a);
}

half4 main(float2 xy) {
  float2 p = xy / pd;
  half4 base = content(p);
  if (lift < 0.002) return base;
  float2 rel = p - center;
  float d = sdCapsule(rel, halfSize);
  if (d > 1.5) return base;

  float e = 0.75;
  float2 n = normalize(float2(
    sdCapsule(rel + float2(e, 0.0), halfSize) - sdCapsule(rel - float2(e, 0.0), halfSize),
    sdCapsule(rel + float2(0.0, e), halfSize) - sdCapsule(rel - float2(0.0, e), halfSize)) + 0.00001);

  // Only the rim bends: the middle of the drop shows the bar exactly as it is. As in the iOS 26
  // tab bar, the flat top and bottom look outward (pulling the bar's own edges in, so the bar reads
  // thinner through the drop), while the rounded ends look inward and magnify, smearing whatever
  // sits under them into a bright blob around the curve with strong colour fringes.
  float edge = 1.0 - clamp(-d / band, 0.0, 1.0);
  float bend = edge * edge;
  float2 src = p + n * bend * (distortion + motion * 6.0) * lift;

  // Each rounded end is a radial lens around its cap centre: the pull toward the centre grows with
  // the radius, so magnification is smooth and round and strongest at the tip.
  float capR = halfSize.y;
  float2 cap = center + float2(sign(rel.x) * max(halfSize.x - capR, 0.0), 0.0);
  float2 fromCap = p - cap;
  float capDist = length(fromCap);
  float ends = smoothstep(0.0, 0.7, abs(fromCap.x) / capR) * step(0.0, abs(rel.x) - (halfSize.x - capR));
  float2 lensSrc = cap + fromCap * (1.0 - 0.32 * clamp(capDist / capR, 0.0, 1.0) * lift);
  src = mix(src, lensSrc, ends);
  // Flattened, the flat top and bottom only see the bar (a page-coloured lip would read as inset).
  float barEdge = barHalf.y - 1.0;
  src.y = mix(src.y, clamp(src.y, barCenter.y - barEdge, barCenter.y + barEdge), flatten);

  float split = (chroma * (1.0 + 0.2 * ends) + motion * 1.5) * bend * lift;
  half4 g = content(src);
  half r = content(src + n * split).r;
  half b = content(src - n * split).b;
  half4 seen = half4(r, g.g, b, g.a);

  // Where the bent view runs past the bar's edge, show the page there instead of the bar's glass
  // (the native blur is under this canvas, so it's painted over with the page colour).
  float barAtSrc = sdCapsule(src - barCenter, barHalf);
  float barHere = sdCapsule(p - barCenter, barHalf);
  float pastBar = smoothstep(-0.75, 0.75, barAtSrc) * smoothstep(0.75, -0.75, barHere);
  half4 glass = seen + half4(page) * half(pastBar) * (1.0 - seen.a);
  glass = glass + half4(body) * (1.0 - glass.a);

  // Clear glass reads through its light: a thin key-lit line on the rim and a hairline Fresnel
  // glow just inside it. Nothing brightens the body, so the drop never looks like a second pill.
  float2 keyDir = normalize(float2(0.55, 0.85));
  float light = 0.25 + 0.9 * max(0.0, dot(-n, keyDir)) + 0.45 * max(0.0, dot(n, keyDir));
  float rimLine = smoothstep(1.3, 0.0, abs(d)) * rim * light;
  float fresnel = smoothstep(-2.5, 0.0, d) * 0.12 * rim;
  float shine = rimLine + fresnel;
  glass.rgb += half3(shine) * (1.0 - glass.a * 0.5);
  glass.a = max(glass.a, half(shine));

  // The glass turns fully opaque early in the pop-up and ignores spring overshoot, so the
  // unrefracted icons never show through as a ghost copy.
  float inside = smoothstep(1.0, -0.5, d) * clamp(lift * 2.5, 0.0, 1.0);
  return mix(base, glass, half(inside));
}
`)!;

/**
 * iOS 26-style floating tab bar: native glass behind, and a Skia layer whose droplet refracts
 * the real icons in place while dragging, then snaps to the nearest tab.
 */
export function GlassTabBar({
  items,
  activeIndex,
  onChange,
  isDark,
  activeColor,
  inactiveColor,
  labelFontSource,
  blurTarget,
  style,
}: GlassTabBarProps) {
  const { width: windowWidth } = useWindowDimensions();
  const k = tabBarScale(windowWidth);
  const HEIGHT = Math.round(TAB_BAR_HEIGHT * k);
  const INSET = BASE_INSET * k;
  const PILL_H = HEIGHT - INSET * 2;
  const ICON = BASE_ICON * k;
  const LABEL_SIZE = BASE_LABEL * k;
  const ICON_Y = BASE_ICON_Y * k;
  const LABEL_Y = BASE_LABEL_Y * k;
  const [width, setWidth] = useState(0);
  const slot = width > 0 ? (width - INSET * 2) / items.length : 0;
  const fontManager = useFonts({ TabLabel: [labelFontSource] });

  const reduceMotion = useReducedMotion();
  // Drop position (left of its tab cell, dp), its velocity (dp/ms) and where it's heading.
  const x = useSharedValue(0);
  const xv = useSharedValue(0);
  const goal = useSharedValue(0);
  const lift = useSharedValue(0);
  // 0..1 while the bar is held: it swells and brightens.
  const press = useSharedValue(0);
  // ms since the last press, counted by the frame callback.
  const sincePress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastIndex = useSharedValue(activeIndex);
  // Goal and finger x at press, and whether the press has become a drag.
  const anchorX = useSharedValue(0);
  const anchorFinger = useSharedValue(0);
  const moved = useSharedValue(false);
  // The tab drawn selected at rest; moved on release so the new tab lights up before navigation.
  const restIndex = useSharedValue(activeIndex);
  // Flatten amount (1 = squashed to the bar, negative = rebounding taller) and stretch, with their
  // spring velocities, and the smoothed signed speed that shifts the trailing end.
  const flat = useSharedValue(0);
  const flatV = useSharedValue(0);
  const stretch = useSharedValue(0);
  const stretchV = useSharedValue(0);
  const trail = useSharedValue(0);
  const liquidRunning = useSharedValue(false);
  // Read by the lens uniforms so bumping it forces a repaint without moving anything.
  const repaint = useSharedValue(0);
  // Where the last settle was aimed (NaN until the first one).
  const settledOn = useSharedValue(Number.NaN);
  // Set once the frame callback exists; the callback stops itself through this on the JS thread.
  const liquidRef = useRef<{ setActive: (active: boolean) => void } | null>(null);
  const stopLiquid = () => {
    if (!liquidRunning.get()) liquidRef.current?.setActive(false);
  };

  // The liquid simulation only runs while the droplet moves (drag, tap, settle) and stops itself
  // once everything is at rest, so an idle tab bar costs nothing. All springs are integrated in
  // small fixed sub-steps, so they behave the same at 60 or 120 Hz and through dropped frames.
  const liquid = useFrameCallback((info) => {
    const dt = Math.min(48, info.timeSincePreviousFrame ?? 16);
    const steps = Math.ceil(dt / STEP_MS);
    const h = dt / steps;
    const min = INSET;
    const max = width - INSET - slot;
    const give = END_GIVE * k;
    const held = dragging.get();
    sincePress.set(sincePress.get() + dt);
    let g = goal.get();
    const v0 = xv.get();
    if (held && ((g <= min && v0 < 0) || (g >= max && v0 > 0))) {
      g += Math.max(-give, Math.min(give, v0 * END_CARRY_MS));
    }
    let p = x.get();
    let v = xv.get();
    let f = flat.get();
    let fv = flatV.get();
    let st = stretch.get();
    let sv = stretchV.get();
    const fZeta = reduceMotion ? 1 : FLAT_ZETA;
    for (let i = 0; i < steps; i++) {
      const before = g - p;
      const lastSpeed = Math.abs(v);
      const past = p < min || p > max;
      const omega = past ? END_OMEGA : FOLLOW_OMEGA;
      const zeta = past ? END_ZETA : FOLLOW_ZETA;
      v += (omega * omega * before - 2 * zeta * omega * v) * h;
      p += v * h;
      if (!held && before * (g - p) < 0) {
        // Landings never swing past the tab (so a tap to the last tab can't leave the bar); the
        // flatten spring supplies the jiggle as the drop stops.
        p = g;
        v = 0;
      } else if (p < min - give || p > max + give) {
        p = Math.min(max + give, Math.max(min - give, p));
        v = 0;
      }
      const speed = reduceMotion ? 0 : Math.abs(v);
      if (!reduceMotion && speed < lastSpeed) fv -= (lastSpeed - speed) * DECEL_KICK;
      const flatTarget = smoothstep(FLATTEN_FROM, FLATTEN_TO, speed);
      fv += (FLAT_OMEGA * FLAT_OMEGA * (flatTarget - f) - 2 * fZeta * FLAT_OMEGA * fv) * h;
      f += fv * h;
      const stretchTarget = smoothstep(STRETCH_FROM, STRETCH_TO, speed);
      sv += (MORPH_OMEGA * MORPH_OMEGA * (stretchTarget - st) - 2 * MORPH_OMEGA * sv) * h;
      st += sv * h;
    }
    if (f < -TALL_MAX) {
      f = -TALL_MAX;
      fv = Math.max(0, fv);
    }
    x.set(p);
    xv.set(v);
    flat.set(Math.min(1, f));
    flatV.set(fv);
    stretch.set(Math.min(1, Math.max(0, st)));
    stretchV.set(sv);
    const signed = reduceMotion ? 0 : Math.max(-1, Math.min(1, v / FULL_SPEED));
    trail.set(trail.get() + (signed - trail.get()) * Math.min(1, dt / 40));

    const atRest =
      !held &&
      lift.get() < 0.001 &&
      Math.abs(g - p) < 0.01 &&
      Math.abs(v) < 0.00002 &&
      Math.abs(f) < 0.002 &&
      Math.abs(fv) < 0.00002 &&
      Math.abs(st) < 0.002 &&
      Math.abs(trail.get()) < 0.002;
    if (atRest && liquidRunning.get()) {
      liquidRunning.set(false);
      x.set(g);
      xv.set(0);
      flat.set(0);
      flatV.set(0);
      stretch.set(0);
      stretchV.set(0);
      trail.set(0);
      scheduleOnRN(stopLiquid);
    }
  }, false);
  useEffect(() => {
    liquidRef.current = liquid;
  }, [liquid]);
  const startLiquid = () => {
    liquidRunning.set(true);
    liquid.setActive(true);
  };

  // Moves the drop when the tab changes from outside (links, first layout). A release already
  // sent it there, so that case doesn't restart it mid-flight.
  useEffect(() => {
    if (slot === 0 || dragging.get()) return;
    restIndex.set(activeIndex);
    const target = INSET + activeIndex * slot;
    if (lastIndex.get() === activeIndex && settledOn.get() === target) return;
    const first = Number.isNaN(settledOn.get());
    lastIndex.set(activeIndex);
    settledOn.set(target);
    goal.set(target);
    if (first) {
      x.set(target);
      return;
    }
    startLiquid();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startLiquid only touches stable refs
  }, [activeIndex, dragging, goal, lastIndex, restIndex, settledOn, slot, x]);

  const indexAt = (px: number) => {
    "worklet";
    return Math.min(items.length - 1, Math.max(0, Math.floor((px - INSET) / Math.max(1, slot))));
  };

  // Everything here runs on the UI thread; the only JS hops are waking the liquid simulation and
  // the final tab switch, so React never renders during a drag.
  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      dragging.set(true);
      if (!liquidRunning.get()) {
        liquidRunning.set(true);
        scheduleOnRN(startLiquid);
      }
      sincePress.set(0);
      lift.set(withSpring(1, LIFT_IN));
      press.set(withSpring(1, PRESS_IN));
      const index = indexAt(event.x);
      const home = INSET + index * slot;
      anchorX.set(home);
      anchorFinger.set(event.x);
      moved.set(false);
      goal.set(home);
      lastIndex.set(index);
    })
    .onChange((event) => {
      const travel = event.x - anchorFinger.get();
      if (!moved.get()) {
        if (Math.abs(travel) < DRAG_SLOP) return;
        moved.set(true);
      }
      // No rubber band: the goal stops at the end tabs; only the drop's own momentum carries it past.
      const target = Math.min(width - INSET - slot, Math.max(INSET, anchorX.get() + travel));
      goal.set(target);
      // The tab under the goal's centre is the one picked, wherever the finger grabbed it.
      const index = indexAt(target + slot / 2);
      lastIndex.set(index);
    })
    .onFinalize(() => {
      const index = lastIndex.get();
      const target = INSET + index * slot;
      dragging.set(false);
      restIndex.set(index);
      settledOn.set(target);
      goal.set(target);
      const wait = Math.max(0, MIN_LIFT_MS - sincePress.get());
      lift.set(withDelay(wait, withSpring(0, LIFT_OUT)));
      press.set(withDelay(wait, withSpring(0, PRESS_OUT)));
      if (index !== activeIndex) scheduleOnRN(onChange, index);
    });

  // Liquid shape: flattened to the bar (then stretched) at speed, rebounding taller and narrower as
  // it slows, and longer behind its direction of travel.
  const shape = useDerivedValue(() => {
    const f = flat.get();
    return {
      flatten: Math.max(0, f),
      tall: Math.max(0, -f),
      scaleX: (1 + STRETCH * stretch.get()) * (1 - WOBBLE_X * Math.max(0, -f) + 0.03 * Math.max(0, f)),
      trail: trail.get() * TRAIL * k,
      motion: Math.min(1, Math.abs(xv.get()) / FULL_SPEED),
    };
  });

  const uniforms = useDerivedValue(() => {
    repaint.get();
    const l = lift.get();
    const { flatten, tall, scaleX, trail: lag, motion } = shape.get();
    const lifted = (PILL_H / 2) * (1 + l * GROW_Y);
    // Flat, the drop's rim lies on the bar's rim (drawn half a dp inside its edge); a lifted drop is
    // never shorter than the bar.
    const barHalf = HEIGHT / 2 - 0.5;
    const flatHalf = Math.min(lifted, barHalf);
    const floor = PILL_H / 2 + (barHalf - PILL_H / 2) * Math.min(1, Math.max(0, l));
    const halfY = Math.max(floor, lifted + (flatHalf - lifted) * flatten + (lifted - flatHalf) * tall);
    // The stretched drop squashes against the bar's ends instead of poking past them; only the
    // lifted drop may grow beyond the bar.
    const give = l * (slot / 2) * GROW_X;
    const cx = BLEED + x.get() + slot / 2;
    const hx = (slot / 2) * (1 + l * GROW_X) * scaleX;
    // The trailing end hangs back (lag is signed with the direction of travel).
    const left = Math.max(cx - hx - Math.max(0, lag), BLEED + INSET - give);
    const right = Math.min(cx + hx - Math.min(0, lag), BLEED + width - INSET + give);
    return {
      pd: PD,
      center: [(left + right) / 2, BLEED + HEIGHT / 2],
      halfSize: [Math.max(PILL_H / 2, (right - left) / 2), halfY],
      lift: l,
      band: halfY * 0.6,
      distortion: RIM_BEND * k,
      chroma: 1.4,
      body: [0, 0, 0, 0],
      rim: isDark ? 0.9 : 1,
      motion,
      barCenter: [BLEED + width / 2, BLEED + HEIGHT / 2],
      barHalf: [width / 2, HEIGHT / 2],
      page: isDark ? PAGE_DARK : PAGE_LIGHT,
      flatten,
      // The rest tab stays lit until the drop has lifted enough to take over (and lights again as
      // it lands), so a press never shows the active icon plain for a frame.
      restCell: l > REST_HANDOFF ? [0, -1] : [BLEED + INSET + slot * restIndex.get(), BLEED + INSET + slot * (restIndex.get() + 1)],
      // At rest the drop is the selected tab's pill: its own shape, tinted, fading out as it lifts.
      pill: [(left + right) / 2, BLEED + HEIGHT / 2, Math.max(PILL_H / 2, (right - left) / 2), halfY],
      pillColor: (isDark ? PILL_DARK : PILL_LIGHT).map((c) => c * (1 - l)),
      glow: press.get() * (isDark ? 0.05 : 0.12),
    };
  });

  const barStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + PRESS_SCALE * press.get() }] }));
  const labels = useMemo(() => {
    if (!fontManager || slot === 0) return null;
    const make = (label: string, color: string) => {
      const builder = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fontManager);
      builder.pushStyle({
        color: Skia.Color(color),
        fontFamilies: ["TabLabel"],
        fontSize: LABEL_SIZE,
        // Keeps labels legible over busy content now that the glass is clearer.
        shadows: [{ color: Skia.Color(isDark ? ICON_SHADOW_DARK : ICON_SHADOW_LIGHT), offset: { x: 0, y: 0.5 }, blurRadius: 2 }],
      });
      builder.addText(label);
      const paragraph = builder.build();
      paragraph.layout(slot);
      return paragraph;
    };
    return {
      plain: items.map((item) => make(item.label, inactiveColor)),
      selected: items.map((item) => make(item.label, activeColor)),
    };
  }, [LABEL_SIZE, activeColor, fontManager, inactiveColor, isDark, items, slot]);

  const renderRow = (isSelected: (index: number) => boolean, rowLabels: NonNullable<typeof labels>["plain"]) =>
    items.map((item, index) => {
      const selected = isSelected(index);
      const color = selected ? activeColor : inactiveColor;
      const cx = BLEED + INSET + slot * index + slot / 2;
      const icon = TAB_ICONS[item.icon];
      const shadow = isDark ? ICON_SHADOW_DARK : ICON_SHADOW_LIGHT;
      const solid = selected && icon.solid;
      return (
        <Group key={item.key}>
          {/* A soft offset copy under each icon keeps it legible over the clearer glass. */}
          <Group transform={[{ translateX: cx - ICON / 2 }, { translateY: BLEED + ICON_Y + 0.6 }, { scale: ICON / 24 }]}>
            <Path path={solid ? icon.solid! : icon.stroke} style={solid ? "fill" : "stroke"} strokeWidth={2.6} strokeCap="round" strokeJoin="round" color={shadow} />
          </Group>
          <Group transform={[{ translateX: cx - ICON / 2 }, { translateY: BLEED + ICON_Y }, { scale: ICON / 24 }]}>
            {solid ? (
              <>
                <Path path={icon.solid!} color={color} />
                {icon.cutout ? (
                  <Path path={icon.cutout} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" blendMode="clear" />
                ) : null}
              </>
            ) : (
              <Path path={icon.stroke} style="stroke" strokeWidth={selected ? 2.1 : 1.7} strokeCap="round" strokeJoin="round" color={color} />
            )}
            {icon.dot ? <Path path={icon.dot} color={solid ? "#000000" : color} blendMode={solid ? "clear" : "srcOver"} /> : null}
          </Group>
          <Paragraph paragraph={rowLabels[index]} x={BLEED + INSET + slot * index} y={BLEED + LABEL_Y} width={slot} />
        </Group>
      );
    });
  // Both rows (with the bar's rim, which the drop bends inward with the bar) are rendered once into
  // device-pixel images, so a frame is one shaded rect instead of re-recording every icon.
  const canvasW = width + BLEED * 2;
  const canvasH = HEIGHT + BLEED * 2;
  const [rows, setRows] = useState<{ plain: SkImage; selected: SkImage; key: string } | null>(null);
  const rowsKey = `${canvasW}x${canvasH}:${activeColor}:${inactiveColor}:${isDark}:${items.map((item) => item.key).join()}`;
  useEffect(() => {
    if (!labels || slot === 0) return;
    let cancelled = false;
    const size = { width: Math.ceil(canvasW * PD), height: Math.ceil(canvasH * PD) };
    const rim = (
      <RoundedRect x={BLEED + 0.5} y={BLEED + 0.5} width={width - 1} height={HEIGHT - 1} r={HEIGHT / 2} style="stroke" strokeWidth={1}>
        <LinearGradient
          start={vec(BLEED, BLEED)}
          end={vec(BLEED + width * 0.6, BLEED + HEIGHT)}
          colors={isDark ? RIM_DARK : RIM_LIGHT}
          positions={[0, 0.35, 0.8, 1]}
        />
      </RoundedRect>
    );
    const draw = (selected: boolean) =>
      drawAsImage(
        <Group transform={[{ scale: PD }]}>
          {rim}
          {renderRow(() => selected, selected ? labels.selected : labels.plain)}
        </Group>,
        size,
      );
    Promise.all([draw(false), draw(true)]).then(([plain, selected]) => {
      if (!cancelled && plain && selected) setRows({ plain, selected, key: rowsKey });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rowsKey covers what renderRow reads
  }, [labels, rowsKey]);
  const canvasReady = slot > 0 && rows !== null;
  // Android can drop the canvas's first frame on a cold start (the surface isn't attached yet), and
  // an idle bar never draws again, so it stays empty until touched. Repaint once it's on screen.
  useEffect(() => {
    if (!canvasReady) return;
    const timers = [100, 500].map((ms) => setTimeout(() => repaint.set(repaint.get() + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [canvasReady, repaint]);

  return (
    <Animated.View
      accessibilityRole="tablist"
      style={[styles.bar, { height: HEIGHT, borderRadius: HEIGHT / 2 }, style, barStyle]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <GlassSurface isDark={isDark} radius={HEIGHT / 2} blurTarget={blurTarget} clarity="clear" />

      {canvasReady ? (
        <Canvas style={[styles.canvas, { width: canvasW, height: canvasH }]} pointerEvents="none">
          <Group transform={[{ scale: 1 / PD }]}>
            <Fill>
              <Shader source={LENS} uniforms={uniforms}>
                <ImageShader image={rows.plain} x={0} y={0} width={rows.plain.width()} height={rows.plain.height()} fit="fill" />
                <ImageShader image={rows.selected} x={0} y={0} width={rows.selected.width()} height={rows.selected.height()} fit="fill" />
              </Shader>
            </Fill>
          </Group>
        </Canvas>
      ) : null}

      <GestureDetector gesture={pan}>
        <View style={[styles.row, { paddingHorizontal: INSET }]}>
          {items.map((item, index) => (
            <View
              key={item.key}
              accessible
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: index === activeIndex }}
              style={styles.item}
            />
          ))}
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  canvas: { position: "absolute", top: -BLEED, left: -BLEED },
  row: { flex: 1, flexDirection: "row" },
  item: { flex: 1 },
});
