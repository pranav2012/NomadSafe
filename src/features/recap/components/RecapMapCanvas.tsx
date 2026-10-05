import React, { useMemo } from "react";
import { StyleSheet } from "react-native";
import { BlurMask, Canvas, Circle, DashPathEffect, Fill, Group, LinearGradient, Path, RadialGradient, vec } from "react-native-skia";
import { useDerivedValue, type DerivedValue, type SharedValue } from "react-native-reanimated";
import { auraDark } from "@/constants/aura";
import type { GeoBox } from "../utils/countryShapes";
import type { Camera, MapFrame } from "../utils/recapMap";
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
}

/** Widens a box around its centre, so zooming out past the route still shows land. */
function grow(box: GeoBox, factor: number): GeoBox {
  const lon = ((box.east - box.west) * (factor - 1)) / 2;
  const lat = ((box.north - box.south) * (factor - 1)) / 2;
  return { west: box.west - lon, east: box.east + lon, south: Math.max(-85, box.south - lat), north: Math.min(85, box.north + lat) };
}

function Leg({ path, mode, index, reveal, zoom, gradient }: { path: RecapGeometryLeg["path"]; mode: RecapLeg["mode"]; index: number; reveal: SharedValue<number>; zoom: SharedValue<number>; gradient: React.ReactNode }) {
  const end = useDerivedValue(() => Math.max(0, Math.min(1, reveal.get() - index)));
  const width = useDerivedValue(() => 4 / zoom.get());
  const glowWidth = useDerivedValue(() => 12 / zoom.get());
  const dashes = legDashes(mode);
  return (
    <Group>
      <Path path={path} style="stroke" strokeWidth={glowWidth} end={end} opacity={0.45}>
        {gradient}
        <BlurMask blur={6} style="normal" />
      </Path>
      <Path path={path} style="stroke" strokeWidth={width} strokeCap="round" end={end}>
        {gradient}
        {dashes ? <DashPathEffect intervals={dashes.map((d) => d * 0.6)} /> : null}
      </Path>
    </Group>
  );
}

type RecapGeometryLeg = ReturnType<typeof buildRecapGeometry>["legs"][number];

/** The replay's map: aurora sky, country outlines and the route, panned and zoomed by `camera`. */
export function RecapMapCanvas({ width, height, frame, stops, legs, countries, camera, reveal, current, opacity }: Props) {
  const geometry = useMemo(() => buildRecapGeometry(frame, stops, legs, countries, grow(frame.box, 3)), [frame, stops, legs, countries]);
  const zoom = useDerivedValue(() => camera.get().zoom);
  const transform = useDerivedValue(() => {
    const { x, y, zoom: z } = camera.get();
    return [{ translateX: x }, { translateY: y }, { scale: z }];
  });
  const outline = useDerivedValue(() => 1.2 / zoom.get());
  const dot = useDerivedValue(() => 5 / zoom.get());
  const bigDot = useDerivedValue(() => 9 / zoom.get());
  const halo = useDerivedValue(() => 22 / zoom.get());
  const [g0, g1] = geometry.gradient;
  const gradient = <LinearGradient start={vec(g0.x, g0.y)} end={vec(g1.x, g1.y)} colors={AURORA} positions={AURORA_STOPS} />;

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
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
          <Leg key={i} path={leg.path} mode={leg.mode} index={i} reveal={reveal} zoom={zoom} gradient={gradient} />
        ))}
        {geometry.points.map((p, i) => (
          <StopDot key={i} x={p.x} y={p.y} index={i} current={current} reveal={reveal} dot={dot} bigDot={bigDot} halo={halo} />
        ))}
      </Group>
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
