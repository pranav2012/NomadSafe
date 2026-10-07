import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Canvas, DashPathEffect, Fill, Glyphs, Group, Path, RoundedRect, Shader, Skia, useFont, type SkFont } from "react-native-skia";
import { SensorType, useAnimatedReaction, useAnimatedSensor, useDerivedValue, useSharedValue, type SharedValue } from "react-native-reanimated";
import { AURA_FONT_FILES, auraFonts as f } from "@/constants/aura";
import { useLocalization } from "@/localization";

// Pebbled navy leather: layered value noise read as a height map and lit from the top left.
const LEATHER = Skia.RuntimeEffect.Make(`
uniform float2 res;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

float noise(float2 p) {
  float2 i = floor(p);
  float2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

float pebble(float2 p) { return noise(p * 0.6) * 0.55 + noise(p * 1.4) * 0.25 + noise(p * 0.09) * 0.4; }

half4 main(float2 xy) {
  float2 uv = xy / res;
  float h = pebble(xy);
  float3 n = normalize(float3((h - pebble(xy + float2(0.7, 0.0))) * 2.4, (h - pebble(xy + float2(0.0, 0.7))) * 2.4, 1.0));
  float diffuse = dot(n, normalize(float3(-0.45, -0.65, 0.9)));
  float3 base = mix(float3(0.085, 0.10, 0.22), float3(0.05, 0.06, 0.15), uv.y);
  base *= 0.88 + 0.24 * noise(xy * 0.018);
  float glow = exp(-length((uv - float2(0.22, 0.12)) * float2(1.0, 1.5)) * 2.4) * 0.09;
  float vignette = 1.0 - 0.35 * smoothstep(0.35, 0.95, length((uv - 0.5) * float2(1.2, 1.0)));
  float3 col = (base * (0.66 + 0.55 * diffuse) + glow) * vignette;
  return half4(half3(col), 1.0);
}
`)!;

// Gold foil: warm metal bands plus a bright streak whose position follows the tilt / opening angle.
const FOIL = Skia.RuntimeEffect.Make(`
uniform float2 res;
uniform float sheen;

half4 main(float2 xy) {
  float2 uv = xy / res;
  float t = uv.x * 0.8 + uv.y * 0.6;
  float band = 0.5 + 0.5 * sin(t * 8.0 + sheen * 3.0);
  float3 col = mix(float3(0.50, 0.36, 0.14), float3(0.86, 0.69, 0.34), smoothstep(0.0, 0.7, band));
  float streak = exp(-pow((t - 0.75 - sheen * 0.7) * 4.5, 2.0));
  col = mix(col, float3(1.0, 0.94, 0.74), streak * 0.85);
  col += (fract(sin(dot(floor(xy * 2.0), float2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.06;
  return half4(half3(col), 1.0);
}
`)!;

const ENDPAPER = Skia.RuntimeEffect.Make(`
uniform float2 res;

float lines(float v, float period) {
  float d = abs(fract(v / period) - 0.5) * period;
  return 1.0 - smoothstep(0.0, 0.9, d);
}

half4 main(float2 xy) {
  float2 uv = xy / res;
  float3 col = mix(float3(0.12, 0.13, 0.19), float3(0.07, 0.08, 0.12), uv.y);
  float a = lines(xy.y + sin(xy.x * 0.035) * 14.0 + sin(xy.x * 0.011 + 1.3) * 24.0, 16.0);
  float b = lines(xy.y + sin(xy.x * 0.041 + 2.1) * 12.0 + sin(xy.x * 0.009) * 30.0 + 8.0, 16.0);
  col += float3(0.13, 0.78, 0.72) * a * 0.07 + float3(0.61, 0.48, 1.0) * b * 0.07;
  col += (fract(sin(dot(floor(xy * 1.5), float2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.025;
  return half4(half3(col), 1.0);
}
`)!;

const EMBLEM = 230;
const INSET = 12;
const SENSOR_INTERVAL_MS = 33;

/** The brand mark's N and dotted arc (512-unit artwork), placed at x, y and `size` wide. */
export function markPaths(x: number, y: number, size: number) {
  const scale = size / 512;
  const p = (px: number, py: number) => `${x + px * scale} ${y + py * scale}`;
  const n = Skia.Path.MakeFromSVGString(`M${p(184, 340)} L${p(184, 172)} L${p(328, 340)} L${p(328, 172)}`)!;
  const arc = Skia.Path.MakeFromSVGString(`M${p(92, 380)} C${p(170, 430)} ${p(342, 430)} ${p(420, 380)}`)!;
  return { n, arc, scale };
}

/** Glyphs for `text` with extra tracking, centred on `cx`. */
function tracked(font: SkFont, text: string, tracking: number, cx: number, y: number) {
  const ids = font.getGlyphIDs(text);
  const widths = font.getGlyphWidths(ids);
  const total = widths.reduce((sum, w) => sum + w, 0) + tracking * (ids.length - 1);
  let x = cx - total / 2;
  return ids.map((id, i) => {
    const glyph = { id, pos: { x, y } };
    x += widths[i] + tracking;
    return glyph;
  });
}

interface CoverProps {
  width: number;
  height: number;
  turn: SharedValue<number>;
  live: boolean;
}

/** The closed passport: grained navy leather, stitched border and a gold-foil emblem and title. */
export function PassportCover({ width, height, turn, live }: CoverProps) {
  const { t } = useLocalization();
  const titleFont = useFont(AURA_FONT_FILES.InstrumentSans_600SemiBold, 25);
  const brandFont = useFont(AURA_FONT_FILES.InstrumentSans_500Medium, 11);
  const tilt = useSharedValue(0);
  const cx = width / 2;
  const centerY = height * 0.38;
  const emblemY = centerY - EMBLEM / 2;
  const titleY = centerY + (EMBLEM * 161) / 512 + 38;
  const { n, arc, scale } = useMemo(() => markPaths(cx - EMBLEM / 2, emblemY, EMBLEM), [cx, emblemY]);
  const local = t("passport.title").toLocaleUpperCase();

  const leather = useMemo(() => ({ res: [width, height] }), [width, height]);
  const foil = useDerivedValue(() => ({ res: [width, height], sheen: tilt.get() + Math.min(1, Math.max(0, turn.get())) * 1.4 }));

  return (
    <View style={StyleSheet.absoluteFill}>
      {live ? <TiltSensor target={tilt} /> : null}
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fill>
          <Shader source={LEATHER} uniforms={leather} />
        </Fill>
        <RoundedRect x={INSET} y={INSET + 1} width={width - INSET * 2} height={height - INSET * 2} r={18} style="stroke" strokeWidth={1.4} color="rgba(0,0,0,0.45)">
          <DashPathEffect intervals={[6, 4]} />
        </RoundedRect>
        <RoundedRect x={INSET} y={INSET} width={width - INSET * 2} height={height - INSET * 2} r={18} style="stroke" strokeWidth={1.2} color="rgba(222,196,132,0.42)">
          <DashPathEffect intervals={[6, 4]} />
        </RoundedRect>
        <Group transform={[{ translateY: 1.5 }]}>
          <Path path={n} style="stroke" strokeWidth={46 * scale} strokeCap="round" strokeJoin="round" color="rgba(0,0,0,0.5)" />
        </Group>
        <Group>
          <Shader source={FOIL} uniforms={foil} />
          <Path path={n} style="stroke" strokeWidth={46 * scale} strokeCap="round" strokeJoin="round" />
          <Path path={arc} style="stroke" strokeWidth={6 * scale} strokeCap="round">
            <DashPathEffect intervals={[2 * scale, 14 * scale]} />
          </Path>
          {titleFont ? <Glyphs font={titleFont} x={0} y={0} glyphs={tracked(titleFont, "PASSPORT", 7, cx, titleY)} /> : null}
          {brandFont ? <Glyphs font={brandFont} x={0} y={0} glyphs={tracked(brandFont, "NomadSafe", 3, cx, height - INSET - 22)} /> : null}
        </Group>
      </Canvas>
      {local !== "PASSPORT" ? (
        <Text numberOfLines={1} style={[styles.local, { top: titleY + 12, width }]}>
          {local}
        </Text>
      ) : null}
      <View pointerEvents="none" style={styles.hinge} />
    </View>
  );
}

/** The inside of the cover, seen as it swings past upright. */
export function PassportEndpaper({ width, height }: { width: number; height: number }) {
  const uniforms = useMemo(() => ({ res: [width, height] }), [width, height]);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill>
        <Shader source={ENDPAPER} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}

/** Phone tilt into `target` (about -0.5…0.5); holds still while `turn` is between pages. */
export function TiltSensor({ target, turn }: { target: SharedValue<number>; turn?: SharedValue<number> }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: SENSOR_INTERVAL_MS });
  useAnimatedReaction(
    () => sensor.sensor.get(),
    (g) => {
      if (turn && Math.abs(turn.get() - Math.round(turn.get())) > 0.001) return;
      const len = Math.hypot(g.x, g.y, g.z) || 1;
      target.set(Math.max(-0.5, Math.min(0.5, (g.x / len) * 0.8 + (g.y / len + 0.6) * 0.4)));
    },
  );
  return null;
}

const styles = StyleSheet.create({
  local: { position: "absolute", left: 0, textAlign: "center", fontFamily: f.medium, fontSize: 13, letterSpacing: 2, color: "#C9A85E" },
  hinge: { position: "absolute", left: 14, top: 0, bottom: 0, width: 1.5, backgroundColor: "rgba(0,0,0,0.35)", borderRightWidth: 1, borderRightColor: "rgba(255,255,255,0.05)" },
});
