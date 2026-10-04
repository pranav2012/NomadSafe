import React, { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PixelRatio, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import {
  Canvas,
  Group,
  LinearGradient,
  Paint,
  Paragraph,
  Path,
  RoundedRect,
  RuntimeShader,
  Skia,
  TextAlign,
  rect,
  rrect,
  useFonts,
  vec,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type WithSpringConfig,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { selectionChanged } from "@/utils/haptics";
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

// Room around the bar for the droplet to swell, stretch and rubber-band past it.
const BLEED = 48;
// Pressed droplet, matched to iOS 26 recordings: ~1.3x a tab wide and ~1.1x the bar tall.
// Bar metrics below are at the 402 dp reference width; tabBarScale() shrinks them on narrower screens.
const GROW_X = 0.3;
const GROW_Y = 0.33;
// Squash and stretch: one "speed" value (0 at rest, 1 at FULL_SPEED dp/ms, negative while it
// overshoots after stopping) makes the drop long and flat when fast, tall and narrow as it stops.
// It follows the measured speed through a slightly underdamped spring (per-ms units) -> jelly.
const FULL_SPEED = 2.2;
const STRETCH = 0.5;
const SQUASH = 0.35;
const STIFFNESS = 0.0011;
const DAMPING = 0.026;
// The drop chases the finger on a spring (weight + catch-up) and rubber-bands past the ends.
const FOLLOW: WithSpringConfig = { damping: 17, stiffness: 420, mass: 0.55 };
const EDGE_GIVE = 0.3;
const EDGE_MAX = 34;
const LIFT_IN: WithSpringConfig = { damping: 12, stiffness: 280, mass: 0.7 };
const LIFT_OUT: WithSpringConfig = { damping: 13, stiffness: 210, mass: 0.8 };
// Landings never swing past the tab (so a tap to the last tab can't leave the bar); the jiggle is
// the shape's: a sudden stop kicks the squash-and-stretch spring, so the drop wobbles in place.
const SETTLE: WithSpringConfig = { damping: 14, stiffness: 230, mass: 0.8, overshootClamping: true };
const TRAVEL: WithSpringConfig = { ...FOLLOW, overshootClamping: true };
const IMPACT = 0.02;
const IMPACT_MIN = 0.25;
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

function premultiplied(hex: string, alpha: number): number[] {
  const channel = (i: number) => (parseInt(hex.slice(i, i + 2), 16) / 255) * alpha;
  return [channel(1), channel(3), channel(5), alpha];
}
const RIM_DARK = ["rgba(255,255,255,0.3)", "rgba(255,255,255,0.05)", "rgba(255,255,255,0.05)", "rgba(255,255,255,0.18)"];
const RIM_LIGHT = ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.3)", "rgba(255,255,255,0.3)", "rgba(255,255,255,0.8)"];


// The droplet lens, applied to the layer holding the tab icons and labels so they refract in
// place (drawn once outside the droplet, once bent inside it). Coordinates arrive in device
// pixels because the layer is supersampled; geometry uniforms are in dp.
const LENS = Skia.RuntimeEffect.Make(`
uniform shader image;
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

float sdCapsule(float2 p, float2 b) {
  float r = b.y;
  float2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

half4 main(float2 xy) {
  half4 base = image.eval(xy);
  if (lift < 0.002) return base;
  float2 p = xy / pd;
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

  float split = (chroma * (1.0 + 0.2 * ends) + motion * 1.5) * bend * lift;
  half4 g = image.eval(src * pd);
  half r = image.eval((src + n * split) * pd).r;
  half b = image.eval((src - n * split) * pd).b;
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
  float glow = rimLine + fresnel;
  glass.rgb += half3(glow) * (1.0 - glass.a * 0.5);
  glass.a = max(glass.a, half(glow));

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
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const fontManager = useFonts({ TabLabel: [labelFontSource] });

  const reduceMotion = useReducedMotion();
  const x = useSharedValue(0);
  const lift = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastIndex = useSharedValue(activeIndex);
  // Squash-and-stretch amount and its spring velocity, the smoothed signed direction (for the
  // trailing lag) and last frame's position.
  const speed = useSharedValue(0);
  const speedV = useSharedValue(0);
  const direction = useSharedValue(0);
  const prevX = useSharedValue(0);
  const prevV = useSharedValue(0);
  const liquidRunning = useSharedValue(false);
  // Read by the lens uniforms so bumping it forces a repaint without moving anything.
  const repaint = useSharedValue(0);
  // Set once the frame callback exists; the callback stops itself through this on the JS thread.
  const liquidRef = useRef<{ setActive: (active: boolean) => void } | null>(null);
  const stopLiquid = () => {
    if (!liquidRunning.get()) liquidRef.current?.setActive(false);
  };

  // The liquid simulation only runs while the droplet moves (drag, tap, settle) and stops itself
  // once everything is at rest, so an idle tab bar costs nothing.
  const liquid = useFrameCallback((info) => {
    const dt = Math.min(32, info.timeSincePreviousFrame ?? 16);
    const v = (x.get() - prevX.get()) / dt;
    prevX.set(x.get());
    const stopped = Math.abs(prevV.get()) - Math.abs(v);
    prevV.set(v);
    if (!reduceMotion && !dragging.get() && stopped > IMPACT_MIN) {
      speedV.set(speedV.get() - Math.min(1, stopped / FULL_SPEED) * IMPACT);
    }
    const target = reduceMotion ? 0 : Math.min(1, Math.abs(v) / FULL_SPEED);
    // Semi-implicit Euler on a damped spring pulled toward the current speed; it dips below zero
    // after a stop, which is the tall, narrow half of the wobble.
    speedV.set(speedV.get() + (STIFFNESS * (target - speed.get()) - DAMPING * speedV.get()) * dt);
    speed.set(speed.get() + speedV.get() * dt);
    const signed = reduceMotion ? 0 : Math.max(-1, Math.min(1, v / FULL_SPEED));
    direction.set(direction.get() + (signed - direction.get()) * Math.min(1, dt / 70));

    const atRest =
      !dragging.get() &&
      lift.get() < 0.001 &&
      Math.abs(v) < 0.0005 &&
      Math.abs(speed.get()) < 0.002 &&
      Math.abs(speedV.get()) < 0.00002 &&
      Math.abs(direction.get()) < 0.002;
    if (atRest && liquidRunning.get()) {
      liquidRunning.set(false);
      speed.set(0);
      speedV.set(0);
      prevV.set(0);
      direction.set(0);
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

  useEffect(() => {
    if (slot === 0 || dragging.get()) return;
    prevX.set(x.get());
    startLiquid();
    x.set(withSpring(INSET + activeIndex * slot, SETTLE));
    lastIndex.set(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startLiquid only touches stable refs
  }, [activeIndex, dragging, lastIndex, slot, x]);

  const indexAt = (px: number) => {
    "worklet";
    return Math.min(items.length - 1, Math.max(0, Math.floor((px - INSET) / Math.max(1, slot))));
  };

  // Finger position -> drop target, with rubber-band resistance past the first and last tab.
  const followTarget = (fingerX: number) => {
    "worklet";
    const raw = fingerX - slot / 2;
    const min = INSET;
    const max = width - INSET - slot;
    if (raw < min) return min - Math.min(EDGE_MAX, (min - raw) * EDGE_GIVE);
    if (raw > max) return max + Math.min(EDGE_MAX, (raw - max) * EDGE_GIVE);
    return raw;
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      dragging.set(true);
      prevX.set(x.get());
      if (!liquidRunning.get()) {
        liquidRunning.set(true);
        scheduleOnRN(startLiquid);
      }
      lift.set(withSpring(1, LIFT_IN));
      x.set(withSpring(followTarget(event.x), TRAVEL));
      const index = indexAt(event.x);
      if (index !== lastIndex.get()) {
        lastIndex.set(index);
        scheduleOnRN(selectionChanged);
      }
      scheduleOnRN(setHoverIndex, index);
    })
    .onChange((event) => {
      x.set(withSpring(followTarget(event.x), FOLLOW));
      const index = indexAt(event.x);
      if (index !== lastIndex.get()) {
        lastIndex.set(index);
        scheduleOnRN(selectionChanged);
        scheduleOnRN(setHoverIndex, index);
      }
    })
    .onFinalize(() => {
      const index = lastIndex.get();
      dragging.set(false);
      lift.set(withSpring(0, LIFT_OUT));
      x.set(withSpring(INSET + index * slot, SETTLE));
      scheduleOnRN(setHoverIndex, null);
      scheduleOnRN(onChange, index);
    });

  // Liquid shape: long and flat at speed, tall and narrow as it overshoots after a stop, and
  // trailing slightly behind the direction of travel.
  const shape = useDerivedValue(() => {
    const m = speed.get();
    return {
      scaleX: Math.max(0.75, 1 + STRETCH * m),
      scaleY: Math.max(0.6, 1 - SQUASH * m),
      lagX: -direction.get() * 8,
      motion: Math.min(1, Math.abs(m)),
    };
  });

  const uniforms = useDerivedValue(() => {
    repaint.get();
    const l = lift.get();
    const { scaleX, scaleY, lagX, motion } = shape.get();
    const halfY = (PILL_H / 2) * (1 + l * GROW_Y) * scaleY;
    // The stretched drop squashes against the bar's ends instead of poking past them; only the
    // lifted drop may grow beyond the bar.
    const give = l * (slot / 2) * GROW_X;
    const cx = BLEED + x.get() + slot / 2 + lagX;
    const hx = (slot / 2) * (1 + l * GROW_X) * scaleX;
    const left = Math.max(cx - hx, BLEED + INSET - give);
    const right = Math.min(cx + hx, BLEED + width - INSET + give);
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
    };
  });

  const pillW = useDerivedValue(() => uniforms.get().halfSize[0] * 2);
  const pillH = useDerivedValue(() => uniforms.get().halfSize[1] * 2);
  const pillX = useDerivedValue(() => uniforms.get().center[0] - pillW.get() / 2);
  const pillY = useDerivedValue(() => BLEED + HEIGHT / 2 - pillH.get() / 2);
  const pillR = useDerivedValue(() => pillH.get() / 2);
  const pillOpacity = useDerivedValue(() => 1 - lift.get());
  // While dragging, every tab outside the drop is drawn plain and everything under the drop is drawn
  // selected (clipped to the drop's live shape), so a tab half under the drop is filled where it's
  // covered. At rest only the active tab is selected.
  const plainSelected = hoverIndex !== null ? -1 : activeIndex;
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
      plain: items.map((item, index) => make(item.label, index === plainSelected ? activeColor : inactiveColor)),
      selected: items.map((item) => make(item.label, activeColor)),
    };
  }, [LABEL_SIZE, activeColor, fontManager, inactiveColor, isDark, items, plainSelected, slot]);

  // The drop's current outline, used to clip the selected row; empty while nothing is lifted.
  const dropClip = useDerivedValue(() => {
    const { center, halfSize } = uniforms.get();
    if (lift.get() < 0.01) return rrect(rect(0, 0, 0, 0), 0, 0);
    const [cx, cy] = center;
    const [hx, hy] = halfSize;
    return rrect(rect(cx - hx, cy - hy, hx * 2, hy * 2), Math.min(hx, hy), Math.min(hx, hy));
  });

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
  const canvasReady = slot > 0 && labels !== null;
  // Android can drop the canvas's first frame on a cold start (the surface isn't attached yet), and
  // an idle bar never draws again, so it stays empty until touched. Repaint once it's on screen.
  useEffect(() => {
    if (!canvasReady) return;
    const timers = [100, 500].map((ms) => setTimeout(() => repaint.set(repaint.get() + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [canvasReady, repaint]);

  const pillTint = isDark ? "rgba(255,255,255,0.12)" : "rgba(14,16,24,0.06)";

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { height: HEIGHT, borderRadius: HEIGHT / 2 }, style]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <GlassSurface isDark={isDark} radius={HEIGHT / 2} blurTarget={blurTarget} clarity="clear" />

      {slot > 0 && labels ? (
        <Canvas style={[styles.canvas, { width: width + BLEED * 2, height: HEIGHT + BLEED * 2 }]} pointerEvents="none">
          <Group transform={[{ scale: 1 / PD }]}>
            <Group
              transform={[{ scale: PD }]}
              layer={
                <Paint>
                  <RuntimeShader source={LENS} uniforms={uniforms} />
                </Paint>
              }
            >
              {/* The bar's rim lives in the refracted layer, so the drop bends it inward with the bar. */}
              <RoundedRect x={BLEED + 0.5} y={BLEED + 0.5} width={width - 1} height={HEIGHT - 1} r={HEIGHT / 2} style="stroke" strokeWidth={1}>
                <LinearGradient
                  start={vec(BLEED, BLEED)}
                  end={vec(BLEED + width * 0.6, BLEED + HEIGHT)}
                  colors={isDark ? RIM_DARK : RIM_LIGHT}
                  positions={[0, 0.35, 0.8, 1]}
                />
              </RoundedRect>
              <RoundedRect x={pillX} y={pillY} width={pillW} height={pillH} r={pillR} color={pillTint} opacity={pillOpacity} />
              <Group clip={dropClip} invertClip>
                {renderRow((index) => index === plainSelected, labels.plain)}
              </Group>
              <Group clip={dropClip}>{renderRow(() => true, labels.selected)}</Group>
            </Group>
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
    </View>
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
