import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  BlurMask,
  Canvas,
  DashPathEffect,
  Circle,
  Fill,
  Group,
  ImageShader,
  Path,
  Shader,
  Skia,
  drawAsImage,
  useClock,
  usePathValue,
  type SkImage,
  type SkPathBuilder,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withDecay, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { springs } from "@/components/motion/springs";
import { selectionChanged } from "@/utils/haptics";
import { LAND_PATH } from "./landPath";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const HANDOFF_ZOOM = 3.2;
const TEX_W = 720;
const TEX_H = 360;
const DEG = Math.PI / 180;

// Orthographic globe: per pixel, find the point on the sphere, rotate it back to world space,
// look up land in an equirectangular mask, and draw land as a grid of dots on a lit ocean.
// Outside the disc it paints the atmosphere halo.
const GLOBE = Skia.RuntimeEffect.Make(`
uniform shader land;
uniform float2 center;
uniform float radius;
uniform float dotStep;
uniform float rotLng;
uniform float rotLat;
uniform float3 ocean;
uniform float3 dots;
uniform float3 glow;
uniform float3 bg;
uniform float3 sun;

const float PI = 3.14159265;

half4 main(float2 p) {
  float2 q = (p - center) / radius;
  float r = length(q);
  if (r > 1.0) {
    float halo = exp(-(r - 1.0) * 9.0) * 0.55;
    return half4(half3(mix(bg, glow, halo)), 1.0);
  }
  float z = sqrt(max(0.0, 1.0 - r * r));
  float3 v = float3(q.x, -q.y, z);

  float cl = cos(rotLat); float sl = sin(rotLat);
  float3 a = float3(v.x, v.y * cl + v.z * sl, -v.y * sl + v.z * cl);
  float cg = cos(rotLng); float sg = sin(rotLng);
  float3 w = float3(a.x * cg + a.z * sg, a.y, -a.x * sg + a.z * cg);

  float lat = asin(clamp(w.y, -1.0, 1.0));
  float lng = atan(w.x, w.z);
  float2 uv = float2((lng + PI) / (2.0 * PI) * ${TEX_W}.0, (PI * 0.5 - lat) / PI * ${TEX_H}.0);
  float isLand = land.eval(uv).r;

  float step = dotStep;
  float2 cell = float2(fract(degrees(lng) / step) - 0.5, fract(degrees(lat) / step) - 0.5);
  float dotMask = smoothstep(0.34, 0.2, length(float2(cell.x * cos(lat), cell.y)));

  float light = clamp(dot(v, normalize(float3(-0.45, 0.55, 0.7))), 0.0, 1.0);
  float sunDot = dot(w, sun);
  float night = smoothstep(0.08, -0.14, sunDot);
  float3 col = ocean * (0.45 + 0.55 * light) * (1.0 - night * 0.55);
  float3 dayDots = dots * (0.35 + 0.65 * light);
  float3 nightDots = float3(1.0, 0.74, 0.42) * (0.3 + 0.35 * light);
  col = mix(col, mix(dayDots, nightDots, night), dotMask * isLand);
  col += glow * exp(-abs(sunDot) * 28.0) * 0.18;
  col += glow * pow(1.0 - z, 3.0) * 0.7;

  float edge = smoothstep(1.0, 1.0 - 1.5 / radius, r);
  float halo = exp(-(r - 1.0) * 9.0) * 0.55;
  return half4(half3(mix(mix(bg, glow, halo), col, edge)), 1.0);
}
`)!;

export interface GlobeStop {
  name: string;
  latitude: number;
  longitude: number;
}

interface GlobeProps {
  stops: GlobeStop[];
  focusIndex: number;
  width: number;
  height: number;
  /** Where the user is now; draws a softer arc from here to the focused stop. */
  origin?: GlobeStop | null;
  contacts?: GlobeStop[];
  sun: [number, number, number];
  contactColor: string;
  accent: string;
  isDark: boolean;
  bg: string;
  /** Pinch released past the hand-off zoom: the point under the centre (degrees) and the globe radius in px. */
  onZoomThrough?: (center: { latitude: number; longitude: number }, radiusPx: number) => void;
  /** Start zoomed in on a point (e.g. coming back out of the map) and ease out to the whole globe. */
  entry?: { latitude: number; longitude: number } | null;
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}

/** Projects a lat/lng onto the globe's disc; z < 0 means it is on the far side. */
function project(lat: number, lng: number, rotLng: number, rotLat: number, cx: number, cy: number, radius: number) {
  "worklet";
  const x0 = Math.cos(lat) * Math.sin(lng);
  const y0 = Math.sin(lat);
  const z0 = Math.cos(lat) * Math.cos(lng);
  const cg = Math.cos(rotLng);
  const sg = Math.sin(rotLng);
  const x1 = x0 * cg - z0 * sg;
  const z1 = x0 * sg + z0 * cg;
  const cl = Math.cos(rotLat);
  const sl = Math.sin(rotLat);
  const y2 = y0 * cl - z1 * sl;
  const z2 = y0 * sl + z1 * cl;
  return { x: cx + x1 * radius, y: cy - y2 * radius, z: z2 };
}

/** Point along the great circle from a to b (0..1), lifted off the surface to read as a flight arc. */
function arcPoint(a: GlobeStop, b: GlobeStop, t: number) {
  "worklet";
  const toV = (s: GlobeStop) => {
    const la = s.latitude * DEG;
    const lo = s.longitude * DEG;
    return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  };
  const va = toV(a);
  const vb = toV(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const s = Math.sin(omega) || 1;
  const k1 = omega === 0 ? 1 - t : Math.sin((1 - t) * omega) / s;
  const k2 = omega === 0 ? t : Math.sin(t * omega) / s;
  const lift = 1 + Math.sin(Math.PI * t) * Math.min(0.18, omega * 0.25);
  const x = (va[0] * k1 + vb[0] * k2) * lift;
  const y = (va[1] * k1 + vb[1] * k2) * lift;
  const z = (va[2] * k1 + vb[2] * k2) * lift;
  const len = Math.sqrt(x * x + y * y + z * z);
  return { lat: Math.asin(y / len), lng: Math.atan2(x, z), lift };
}

/**
 * Dotted 3D globe drawn in one Skia shader, with the trip's flight arcs glowing between stops.
 * On mount it spins to the focused stop; drag to spin it (with momentum), tap to zoom through.
 */
export function Globe({ stops, focusIndex, width, height, origin, contacts = [], sun, contactColor, accent, isDark, bg, onZoomThrough, entry }: GlobeProps) {
  const [land, setLand] = useState<SkImage | null>(null);
  const reduceMotion = useReducedMotion();
  const clock = useClock();
  const baseRadius = Math.min(width, height) * 0.45;
  const zoom = useSharedValue(1);
  const zoomStart = useSharedValue(1);
  const radius = useDerivedValue(() => baseRadius * zoom.get());
  const handoffHinted = useSharedValue(false);
  const fade = useDerivedValue(() => 1 - Math.min(1, Math.max(0, (zoom.get() - HANDOFF_ZOOM) / (MAX_ZOOM - HANDOFF_ZOOM))) * 0.6);
  const cx = width / 2;
  const cy = height / 2;
  const focus = stops[focusIndex] ?? { name: "", latitude: 20, longitude: 0 };
  const targetLng = focus.longitude * DEG;
  const targetLat = Math.max(-0.6, Math.min(0.6, focus.latitude * DEG * 0.8));

  const rotLng = useSharedValue(entry ? entry.longitude * DEG : targetLng - (reduceMotion ? 0 : 2.2));
  const rotLat = useSharedValue(entry ? entry.latitude * DEG : reduceMotion ? targetLat : 0.1);

  useEffect(() => {
    let mounted = true;
    void drawAsImage(
      <Group>
        <Fill color="black" />
        <Path path={LAND_PATH} color="white" transform={[{ scale: TEX_W / 360 }]} />
      </Group>,
      { width: TEX_W, height: TEX_H },
    ).then((image) => {
      if (mounted) setLand(image);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (entry) {
      zoom.set(HANDOFF_ZOOM);
      zoom.set(withSpring(1, springs.sheet));
      return;
    }
    if (reduceMotion) return;
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    rotLng.set(withTiming(targetLng, { duration: 2600, easing: ease }));
    rotLat.set(withTiming(targetLat, { duration: 2600, easing: ease }));
  }, [entry, reduceMotion, rotLat, rotLng, targetLat, targetLng, zoom]);

  const palette = isDark
    ? { ocean: rgb("#121624"), dots: rgb("#C9CEE0") }
    : { ocean: rgb("#DCE1EC"), dots: rgb("#2A3047") };

  const glowRgb = rgb(accent);
  const bgRgb = rgb(bg);
  const uniforms = useDerivedValue(() => ({
    center: [cx, cy],
    radius: radius.get(),
    dotStep: 1.7 / Math.sqrt(zoom.get()),
    rotLng: rotLng.get(),
    rotLat: rotLat.get(),
    ocean: palette.ocean,
    dots: palette.dots,
    glow: glowRgb,
    bg: bgRgb,
    sun,
  }));

  const currentLeg = Math.max(0, focusIndex - 1);
  const traceArc = (builder: SkPathBuilder, a: GlobeStop, b: GlobeStop) => {
    "worklet";
    let drawing = false;
    for (let s = 0; s <= 48; s += 1) {
      const pt = arcPoint(a, b, s / 48);
      const pr = project(pt.lat, pt.lng, rotLng.get(), rotLat.get(), cx, cy, radius.get() * pt.lift);
      if (pr.z < -0.02) {
        drawing = false;
        continue;
      }
      if (!drawing) builder.moveTo(pr.x, pr.y);
      else builder.lineTo(pr.x, pr.y);
      drawing = true;
    }
  };
  const otherLegs = usePathValue((builder) => {
    "worklet";
    for (let i = 0; i < stops.length - 1; i += 1) if (i !== currentLeg) traceArc(builder, stops[i], stops[i + 1]);
  });
  const arcs = usePathValue((builder) => {
    "worklet";
    if (stops.length > 1) traceArc(builder, stops[currentLeg], stops[currentLeg + 1]);
  });
  const homeArc = usePathValue((builder) => {
    "worklet";
    if (origin) traceArc(builder, origin, focus);
  });

  const cometEnd = useDerivedValue(() => (clock.get() % 2600) / 2600);
  const cometStart = useDerivedValue(() => Math.max(0, cometEnd.get() - 0.18));
  const pulse = useDerivedValue(() => (clock.get() % 1600) / 1600);

  const pins = useMemo(() => stops.map((stop, i) => ({ stop, focused: i === focusIndex })), [focusIndex, stops]);

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onChange((event) => {
      const r = radius.get();
      rotLng.set(rotLng.get() - (event.changeX / r) * 0.9);
      rotLat.set(Math.max(-1.3, Math.min(1.3, rotLat.get() + (event.changeY / r) * 0.9)));
    })
    .onEnd((event) => {
      rotLng.set(withDecay({ velocity: -(event.velocityX / radius.get()) * 0.9, deceleration: 0.996 }));
    });
  // Rubber-bands slightly past the limits while pinching, then springs back inside them.
  const pinch = Gesture.Pinch()
    .onBegin(() => {
      zoomStart.set(zoom.get());
    })
    .onUpdate((event) => {
      const next = zoomStart.get() * event.scale;
      if (next >= HANDOFF_ZOOM !== handoffHinted.get()) {
        handoffHinted.set(next >= HANDOFF_ZOOM);
        if (next >= HANDOFF_ZOOM) scheduleOnRN(selectionChanged);
      }
      zoom.set(next < MIN_ZOOM ? MIN_ZOOM - (MIN_ZOOM - next) * 0.3 : next > MAX_ZOOM ? MAX_ZOOM + (next - MAX_ZOOM) * 0.3 : next);
    })
    .onEnd(() => {
      if (onZoomThrough && zoom.get() >= HANDOFF_ZOOM) {
        // The point under the view's centre is (rotLat, rotLng) by construction of the projection.
        const center = { latitude: rotLat.get() / DEG, longitude: (((rotLng.get() / DEG + 540) % 360) - 180) };
        scheduleOnRN(onZoomThrough, center, baseRadius * zoom.get());
        return;
      }
      zoom.set(withSpring(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.get())), springs.sheet));
    });

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View style={{ width, height }}>
        {land ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Group opacity={fade}>
            <Fill>
              <Shader source={GLOBE} uniforms={uniforms}>
                <ImageShader image={land} fit="fill" x={0} y={0} width={TEX_W} height={TEX_H} />
              </Shader>
            </Fill>
            <Path path={homeArc} style="stroke" strokeWidth={1.4} color={isDark ? "#EDEFF5" : "#0E1018"} opacity={0.55} strokeCap="round">
              <DashPathEffect intervals={[3, 5]} />
            </Path>
            <Path path={otherLegs} style="stroke" strokeWidth={1.2} color={accent} opacity={0.3} strokeCap="round" />
            <Path path={arcs} style="stroke" strokeWidth={1.8} color={accent} opacity={0.7} strokeCap="round" />
            <Path path={arcs} style="stroke" strokeWidth={2.6} color={accent} start={cometStart} end={cometEnd} strokeCap="round">
              <BlurMask blur={4} style="solid" />
            </Path>
            {origin ? (
              <GlobePin stop={origin} focused={false} rotLng={rotLng} rotLat={rotLat} cx={cx} cy={cy} radius={radius} accent={isDark ? "#EDEFF5" : "#0E1018"} pulse={pulse} quiet />
            ) : null}
            {contacts.map((contact, i) => (
              <GlobePin key={`contact-${i}`} stop={contact} focused={false} rotLng={rotLng} rotLat={rotLat} cx={cx} cy={cy} radius={radius} accent={contactColor} pulse={pulse} quiet />
            ))}
            {pins.map(({ stop, focused }, i) => (
              <GlobePin
                key={`${stop.name}-${i}`}
                stop={stop}
                focused={focused}
                rotLng={rotLng}
                rotLat={rotLat}
                cx={cx}
                cy={cy}
                radius={radius}
                accent={accent}
                pulse={pulse}
              />
            ))}
            </Group>
          </Canvas>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function GlobePin({
  stop,
  focused,
  rotLng,
  rotLat,
  cx,
  cy,
  radius,
  accent,
  pulse,
  quiet = false,
}: {
  quiet?: boolean;
  stop: GlobeStop;
  focused: boolean;
  rotLng: ReturnType<typeof useSharedValue<number>>;
  rotLat: ReturnType<typeof useSharedValue<number>>;
  cx: number;
  cy: number;
  radius: ReturnType<typeof useDerivedValue<number>>;
  accent: string;
  pulse: ReturnType<typeof useDerivedValue<number>>;
}) {
  const point = useDerivedValue(() => project(stop.latitude * DEG, stop.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, radius.get()));
  const x = useDerivedValue(() => point.get().x);
  const y = useDerivedValue(() => point.get().y);
  const visible = useDerivedValue(() => (point.get().z > 0 ? 1 : 0));
  const ringR = useDerivedValue(() => 4 + pulse.get() * (focused ? 18 : 10));
  const ringOpacity = useDerivedValue(() => (quiet ? 0 : visible.get() * (1 - pulse.get()) * 0.7));

  return (
    <Group opacity={visible}>
      <Circle cx={x} cy={y} r={ringR} color={accent} style="stroke" strokeWidth={1.4} opacity={ringOpacity} />
      <Circle cx={x} cy={y} r={focused ? 5.5 : 3.5} color="#FFFFFF" />
      <Circle cx={x} cy={y} r={focused ? 3.5 : 2.2} color={accent} />
    </Group>
  );
}
