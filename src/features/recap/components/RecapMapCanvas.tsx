import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { BlurMask, Canvas, Circle, DashPathEffect, Fill, Group, LinearGradient, Path, RadialGradient, RoundedRect, Skia, vec } from "react-native-skia";
import { useDerivedValue, type DerivedValue, type SharedValue } from "react-native-reanimated";
import { auraDark } from "@/constants/aura";
import { usePerfTier } from "@/hooks/usePerfTier";
import { useBoundaryStore } from "../utils/boundaries";
import type { GeoBox } from "../utils/countryShapes";
import type { Camera, MapFrame, Point, Rect } from "../utils/recapMap";
import type { RecapLeg, RecapStop } from "../utils/recapFacts";
import { AURORA, AURORA_STOPS, buildRecapGeometry, legDashes } from "./recapGeometry";

interface Props {
  width: number;
  height: number;
  frame: MapFrame;
  stops: RecapStop[];
  legs: RecapLeg[];
  countries: string[];
  camera: DerivedValue<Camera>;
  /** Legs drawn so far: 1.5 means the first leg in full and half of the second. */
  reveal: SharedValue<number>;
  /** The highlighted stop, or -1. */
  current: number;
  /** 0..1, fades the whole map (for the finale). */
  opacity: SharedValue<number>;
  /** 0..1: the map shrinks into `insetRect`, centred on `focus` (a stop's map position), and the rest of the canvas clears. */
  inset?: SharedValue<number>;
  insetRect?: Rect;
  focus?: Point | null;
}

const INSET_RADIUS = 22;
const ZOOM_STEP = Math.pow(2, 1 / 8);
const lerp = (a: number, b: number, k: number) => {
  "worklet";
  return a + (b - a) * k;
};

/** Widens a box around its centre, so zooming out past the route still shows land. */
function grow(box: GeoBox, factor: number): GeoBox {
  const lon = ((box.east - box.west) * (factor - 1)) / 2;
  const lat = ((box.north - box.south) * (factor - 1)) / 2;
  return { west: box.west - lon, east: box.east + lon, south: Math.max(-85, box.south - lat), north: Math.min(85, box.north + lat) };
}

function Leg({ path, mode, index, reveal, zoom, gradient, glow }: { path: RecapGeometryLeg["path"]; mode: RecapLeg["mode"]; index: number; reveal: SharedValue<number>; zoom: SharedValue<number>; gradient: React.ReactNode; glow: boolean }) {
  const end = useDerivedValue(() => Math.max(0, Math.min(1, reveal.get() - index)));
  const width = useDerivedValue(() => 4 / zoom.get());
  const glowWidth = useDerivedValue(() => 12 / zoom.get());
  const dashes = legDashes(mode);
  return (
    <Group>
      {glow ? (
        <Path path={path} style="stroke" strokeWidth={glowWidth} end={end} opacity={0.45}>
          {gradient}
          <BlurMask blur={6} style="normal" />
        </Path>
      ) : null}
      <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" end={end}>
        {gradient}
        {dashes ? <DashPathEffect intervals={dashes.map((d) => d * 0.6)} /> : null}
      </Path>
    </Group>
  );
}

type RecapGeometryLeg = ReturnType<typeof buildRecapGeometry>["legs"][number];

/** The replay's map: aurora sky, country outlines and the route, panned and zoomed by `camera`. */
export function RecapMapCanvas({ width, height, frame, stops, legs, countries, camera, reveal, current, opacity, inset, insetRect, focus }: Props) {
  const view = useBoundaryStore((state) => state.view);
  const geometry = useMemo(() => buildRecapGeometry(frame, stops, legs, countries, grow(frame.box, 3), view), [frame, stops, legs, countries, view]);
  const tier = usePerfTier();
  const lowTier = tier === "low";
  // Low-tier phones change line widths in ~9% zoom steps rather than every frame.
  const zoom = useDerivedValue(() => {
    const z = camera.get().zoom;
    return lowTier ? Math.pow(ZOOM_STEP, Math.round(Math.log(z) / Math.log(ZOOM_STEP))) : z;
  });
  const transform = useDerivedValue(() => {
    const { x, y, zoom: z } = camera.get();
    const k = inset?.get() ?? 0;
    if (k <= 0 || !insetRect || !focus) return [{ translateX: x }, { translateY: y }, { scale: z }];
    // Screen position of the focus stop, moved to the inset's centre and scaled down around it.
    const fx = focus.x * z + x;
    const fy = focus.y * z + y;
    const s = lerp(1, insetRect.width / width, k) * lerp(1, 1.6, k);
    return [
      { translateX: lerp(fx, insetRect.x + insetRect.width / 2, k) },
      { translateY: lerp(fy, insetRect.y + insetRect.height / 2, k) },
      { scale: s },
      { translateX: -fx + x },
      { translateY: -fy + y },
      { scale: z },
    ];
  });
  // The clip keeps the inset's aspect ratio all the way: it starts as that shape scaled to cover the
  // screen (so the first frame looks full-screen) and shrinks uniformly into the corner.
  const clip = useDerivedValue(() => {
    const k = inset?.get() ?? 0;
    const r = insetRect ?? { x: 0, y: 0, width, height };
    const aspect = r.height / r.width;
    const startWidth = Math.max(width, height / aspect);
    const w = lerp(startWidth, r.width, k);
    const cx = lerp(width / 2, r.x + r.width / 2, k);
    const cy = lerp(height / 2, r.y + r.height / 2, k);
    return Skia.RRectXY(Skia.XYWHRect(cx - w / 2, cy - (w * aspect) / 2, w, w * aspect), INSET_RADIUS * k, INSET_RADIUS * k);
  });
  const border = useDerivedValue(() => (inset?.get() ?? 0) * 0.5);
  const outline = useDerivedValue(() => 1.2 / zoom.get());
  const dot = useDerivedValue(() => 5 / zoom.get());
  const bigDot = useDerivedValue(() => 9 / zoom.get());
  const halo = useDerivedValue(() => 22 / zoom.get());
  const [g0, g1] = geometry.gradient;
  const gradient = <LinearGradient start={vec(g0.x, g0.y)} end={vec(g1.x, g1.y)} colors={AURORA} positions={AURORA_STOPS} />;

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Group clip={clip}>
      <Fill color={auraDark.bg} />
      <Fill>
        <RadialGradient c={vec(width * 0.15, 0)} r={width * 0.8} colors={["rgba(34,199,184,0.30)", "rgba(34,199,184,0)"]} />
      </Fill>
      <Fill>
        <RadialGradient c={vec(width * 0.9, height * 0.04)} r={width * 0.85} colors={["rgba(91,108,255,0.38)", "rgba(91,108,255,0)"]} />
      </Fill>
      <Group opacity={opacity} transform={transform}>
        <Path path={geometry.around} color="rgba(255,255,255,0.02)" />
        <Path path={geometry.around} style="stroke" strokeWidth={outline} color="rgba(255,255,255,0.10)" strokeJoin="round" />
        <Path path={geometry.home} color="rgba(255,255,255,0.045)" />
        <Path path={geometry.home} style="stroke" strokeWidth={outline} color="rgba(255,255,255,0.24)" strokeJoin="round" />
        {geometry.legs.map((leg, i) => (
          <Leg key={i} path={leg.path} mode={leg.mode} index={i} reveal={reveal} zoom={zoom} gradient={gradient} glow={!lowTier} />
        ))}
        {geometry.points.map((p, i) => (
          <StopDot key={i} x={p.x} y={p.y} index={i} current={current} reveal={reveal} dot={dot} bigDot={bigDot} halo={halo} />
        ))}
      </Group>
      </Group>
      {inset ? <RoundedRect rect={clip} style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.35)" opacity={border} /> : null}
    </Canvas>
  );
}

function StopDot({ x, y, index, current, reveal, dot, bigDot, halo }: { x: number; y: number; index: number; current: number; reveal: SharedValue<number>; dot: SharedValue<number>; bigDot: SharedValue<number>; halo: SharedValue<number> }) {
  const reached = useDerivedValue(() => (reveal.get() >= index ? 1 : 0));
  const pending = useDerivedValue(() => 1 - reached.get());
  const isCurrent = index === current;
  return (
    <Group>
      {isCurrent ? <Circle cx={x} cy={y} r={halo} color="#8B97FF" opacity={0.22} /> : null}
      <Circle cx={x} cy={y} r={isCurrent ? bigDot : dot} color="#EDEFF5" opacity={reached} />
      <Circle cx={x} cy={y} r={dot} style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.4)" opacity={pending} />
    </Group>
  );
}
