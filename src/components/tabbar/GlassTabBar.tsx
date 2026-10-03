import React, { useEffect, useMemo, useState, type RefObject } from "react";
import { PixelRatio, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
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
  useFonts,
  vec,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { springs } from "@/components/motion/springs";
import { selectionChanged } from "@/utils/haptics";
import { TAB_ICONS, type TabIconName } from "./tabIcons";
import { TAB_BAR_HEIGHT } from "./tabBarInset";

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

const HEIGHT = TAB_BAR_HEIGHT;
const INSET = 5;
const PILL_H = HEIGHT - INSET * 2;
const BLEED = 14;
// Pressed droplet swells past the bar, as in the iOS 26 tab bar.
const GROW_X = 0.18;
const GROW_Y = 0.24;
const ICON = 22;
const LABEL_SIZE = 10.5;
const PD = PixelRatio.get();
const IOS_NATIVE_GLASS = Platform.OS === "ios" && isLiquidGlassAvailable();
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
uniform float magnify;
uniform float chroma;
uniform float4 body;
uniform float rim;

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

  float edge = 1.0 - clamp(-d / band, 0.0, 1.0);
  float bend = edge * edge * edge;
  float2 src = center + rel / mix(1.0, magnify, lift);
  src -= n * bend * distortion * band * lift;

  float split = chroma * bend * lift;
  half4 g = image.eval(src * pd);
  half r = image.eval((src + n * split) * pd).r;
  half b = image.eval((src - n * split) * pd).b;
  half4 seen = half4(r, g.g, b, g.a);

  half4 glass = seen + half4(body) * (1.0 - seen.a);

  // Clear glass reads through its light: a key light on the top-left rim with a softer
  // bounce opposite, a Fresnel band just inside the edge, and a faint sheen on the top half.
  float2 keyDir = normalize(float2(0.55, 0.85));
  float light = 0.25 + 0.9 * max(0.0, dot(-n, keyDir)) + 0.45 * max(0.0, dot(n, keyDir));
  float rimLine = smoothstep(1.3, 0.0, abs(d)) * rim * light;
  float fresnel = pow(edge, 2.6) * 0.26 * rim;
  float sheen = smoothstep(0.15, -0.9, rel.y / halfSize.y) * (1.0 - edge) * 0.07;
  float glow = rimLine + fresnel + sheen;
  float thickness = smoothstep(0.35, 0.95, edge) * (1.0 - smoothstep(0.95, 1.0, edge)) * 0.12;
  glass = half4(glass.rgb * half(1.0 - thickness), glass.a + half(thickness) * (1.0 - glass.a));
  glass.rgb += half3(glow) * (1.0 - glass.a * 0.5);
  glass.a = max(glass.a, half(glow));

  float inside = smoothstep(1.0, -0.5, d) * lift;
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
  const [width, setWidth] = useState(0);
  const slot = width > 0 ? (width - INSET * 2) / items.length : 0;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const fontManager = useFonts({ TabLabel: [labelFontSource] });

  const x = useSharedValue(0);
  const lift = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lastIndex = useSharedValue(activeIndex);

  useEffect(() => {
    if (slot === 0 || dragging.get()) return;
    x.set(withSpring(INSET + activeIndex * slot, springs.snappy));
    lastIndex.set(activeIndex);
  }, [activeIndex, dragging, lastIndex, slot, x]);

  const indexAt = (px: number) => {
    "worklet";
    return Math.min(items.length - 1, Math.max(0, Math.floor((px - INSET) / Math.max(1, slot))));
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((event) => {
      dragging.set(true);
      lift.set(withSpring(1, springs.snappy));
      x.set(withSpring(Math.min(width - INSET - slot, Math.max(INSET, event.x - slot / 2)), springs.press));
      const index = indexAt(event.x);
      if (index !== lastIndex.get()) {
        lastIndex.set(index);
        scheduleOnRN(selectionChanged);
      }
      scheduleOnRN(setHoverIndex, index);
    })
    .onChange((event) => {
      x.set(Math.min(width - INSET - slot, Math.max(INSET, event.x - slot / 2)));
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
      lift.set(withSpring(0, springs.sheet));
      x.set(withSpring(INSET + index * slot, springs.snappy));
      scheduleOnRN(setHoverIndex, null);
      scheduleOnRN(onChange, index);
    });

  const uniforms = useDerivedValue(() => {
    const l = lift.get();
    return {
      pd: PD,
      center: [BLEED + x.get() + slot / 2, BLEED + HEIGHT / 2],
      halfSize: [(slot / 2) * (1 + l * GROW_X), (PILL_H / 2) * (1 + l * GROW_Y)],
      lift: l,
      band: 17,
      distortion: 0.75,
      magnify: 1.16,
      chroma: 0.9,
      body: isDark ? [0.07, 0.07, 0.08, 0.07] : [0.16, 0.16, 0.17, 0.16],
      rim: isDark ? 0.8 : 1,
    };
  });

  const pillX = useDerivedValue(() => BLEED + x.get());
  const pillOpacity = useDerivedValue(() => 1 - lift.get());
  const shownIndex = hoverIndex ?? activeIndex;
  const labels = useMemo(() => {
    if (!fontManager || slot === 0) return null;
    return items.map((item, index) => {
      const builder = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center }, fontManager);
      builder.pushStyle({
        color: Skia.Color(index === shownIndex ? activeColor : inactiveColor),
        fontFamilies: ["TabLabel"],
        fontSize: LABEL_SIZE,
      });
      builder.addText(item.label);
      const paragraph = builder.build();
      paragraph.layout(slot);
      return paragraph;
    });
  }, [activeColor, fontManager, inactiveColor, items, shownIndex, slot]);
  const tint = isDark ? "rgba(10,12,18,0.3)" : "rgba(255,255,255,0.42)";
  const pillTint = isDark ? "rgba(255,255,255,0.12)" : "rgba(14,16,24,0.06)";

  return (
    <View accessibilityRole="tablist" style={[styles.bar, style]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <BarSurface isDark={isDark} tint={tint} blurTarget={blurTarget} />

      {slot > 0 && labels ? (
        <Canvas style={[styles.canvas, { width: width + BLEED * 2 }]} pointerEvents="none">
          {Platform.OS === "android" ? (
            <RoundedRect x={BLEED + 0.5} y={BLEED + 0.5} width={width - 1} height={HEIGHT - 1} r={HEIGHT / 2} style="stroke" strokeWidth={1}>
              <LinearGradient
                start={vec(BLEED, BLEED)}
                end={vec(BLEED + width * 0.6, BLEED + HEIGHT)}
                colors={isDark ? RIM_DARK : RIM_LIGHT}
                positions={[0, 0.35, 0.8, 1]}
              />
            </RoundedRect>
          ) : null}
          <Group transform={[{ scale: 1 / PD }]}>
            <Group
              transform={[{ scale: PD }]}
              layer={
                <Paint>
                  <RuntimeShader source={LENS} uniforms={uniforms} />
                </Paint>
              }
            >
              <RoundedRect x={pillX} y={BLEED + INSET} width={slot} height={PILL_H} r={PILL_H / 2} color={pillTint} opacity={pillOpacity} />
              {items.map((item, index) => {
                const color = index === shownIndex ? activeColor : inactiveColor;
                const cx = BLEED + INSET + slot * index + slot / 2;
                const icon = TAB_ICONS[item.icon];
                return (
                  <Group key={item.key}>
                    <Group transform={[{ translateX: cx - ICON / 2 }, { translateY: BLEED + 11 }, { scale: ICON / 24 }]}>
                      {index === shownIndex && icon.solid ? (
                        <>
                          <Path path={icon.solid} color={color} />
                          {icon.cutout ? (
                            <Path path={icon.cutout} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" blendMode="clear" />
                          ) : null}
                        </>
                      ) : (
                        <Path
                          path={icon.stroke}
                          style="stroke"
                          strokeWidth={index === shownIndex ? 2.1 : 1.7}
                          strokeCap="round"
                          strokeJoin="round"
                          color={color}
                        />
                      )}
                      {icon.dot ? (
                        <Path path={icon.dot} color={index === shownIndex && icon.solid ? "#000000" : color} blendMode={index === shownIndex && icon.solid ? "clear" : "srcOver"} />
                      ) : null}
                    </Group>
                    <Paragraph paragraph={labels[index]} x={BLEED + INSET + slot * index} y={BLEED + 38} width={slot} />
                  </Group>
                );
              })}
            </Group>
          </Group>
        </Canvas>
      ) : null}

      <GestureDetector gesture={pan}>
        <View style={styles.row}>
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

function BarSurface({ isDark, tint, blurTarget }: { isDark: boolean; tint: string; blurTarget?: RefObject<View | null> }) {
  if (Platform.OS === "android") {
    return (
      <BlurView
        style={styles.surface}
        intensity={isDark ? 55 : 65}
        tint={isDark ? "dark" : "light"}
        blurMethod="dimezisBlurViewSdk31Plus"
        blurTarget={blurTarget}
        blurReductionFactor={2.5}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} />
      </BlurView>
    );
  }
  if (IOS_NATIVE_GLASS) {
    return <GlassView style={styles.surface} glassEffectStyle="regular" colorScheme={isDark ? "dark" : "light"} />;
  }
  return <BlurView style={styles.surface} intensity={80} tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"} />;
}

const styles = StyleSheet.create({
  bar: {
    height: HEIGHT,
    borderRadius: HEIGHT / 2,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  surface: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: HEIGHT / 2, overflow: "hidden" },
  canvas: { position: "absolute", top: -BLEED, left: -BLEED, height: HEIGHT + BLEED * 2 },
  row: { flex: 1, flexDirection: "row", paddingHorizontal: INSET },
  item: { flex: 1 },
});
