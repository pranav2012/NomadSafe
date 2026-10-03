import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import {
  AlphaType,
  BlurMask,
  Canvas,
  DashPathEffect,
  Circle,
  ColorType,
  FilterMode,
  Fill,
  Group,
  ImageShader,
  MipmapMode,
  Path,
  Shader,
  Skia,
  useClock,
  usePathValue,
  type SkImage,
  type SkPathBuilder,
} from "react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { springs } from "@/components/motion/springs";
import { useAura } from "@/components/aura/useAura";
import { useGlobeWeather } from "@/features/home/hooks/useGlobeWeather";
import { detailBoxFor, getRegionImagery, type DetailBox } from "@/features/home/services/globeImagery";
import { CLOUD_COLS, CLOUD_ROWS, CLOUD_STEP, type StopWeather } from "@/features/home/services/globeWeather";
import { toUnit, useTemperatureUnit } from "@/features/trips/hooks/useTripForecast";
import { selectionChanged } from "@/utils/haptics";
import { moonIllumination, sunVector } from "./sun";

// NASA Visible Earth (public domain): Blue Marble Next Generation (Sep 2004, least seasonal snow) and Black Marble 2016.
const DAY_TEXTURE = require("../../../../../../assets/images/globe/earth-day.jpg");
const NIGHT_TEXTURE = require("../../../../../../assets/images/globe/earth-night.jpg");
// ESO/S. Brunier, CC BY 4.0 (credited in Settings): the whole Milky Way in galactic coordinates.
const SKY_TEXTURE = require("../../../../../../assets/images/globe/milky-way.jpg");

const MIN_ZOOM = 1;
const DEFAULT_SPAN_KM = 400;
// Overview spin: one turn every 2.5 minutes, eastward like the real Earth.
const SPIN_RAD_PER_MS = (2 * Math.PI) / 150_000;
const SPIN_RESUME_MS = 2000;
const EARTH_RADIUS_KM = 6371;
// Below this zoom the bundled 2048px textures are sharp enough; above it, regional NASA imagery fades in.
const DETAIL_ZOOM = 2.5;
const MIN_HANDOFF_ZOOM = 3.2;
const TEX_W = 2048;
const TEX_H = 1024;
const SKY_W = 2048;
const SKY_H = 1024;
const DEG = Math.PI / 180;
const SMOOTH = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };

interface GlobeTextures {
  day: SkImage;
  night: SkImage;
  sky: SkImage;
}

let textureCache: GlobeTextures | null = null;
let texturePromise: Promise<GlobeTextures> | null = null;

async function decodeAsset(source: number) {
  const data = await Skia.Data.fromURI(Image.resolveAssetSource(source).uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error("globe texture failed to decode");
  return image;
}

/** Decodes the NASA textures once per app session, so remounting the globe (e.g. back from the map) is instant. */
function useGlobeTextures() {
  const [textures, setTextures] = useState(textureCache);
  useEffect(() => {
    if (textures) return;
    let mounted = true;
    texturePromise ??= Promise.all([decodeAsset(DAY_TEXTURE), decodeAsset(NIGHT_TEXTURE), decodeAsset(SKY_TEXTURE)]).then(([day, night, sky]) => {
      textureCache = { day, night, sky };
      return textureCache;
    });
    texturePromise.then(
      (loaded) => {
        if (mounted) setTextures(loaded);
      },
      () => {
        texturePromise = null;
      },
    );
    return () => {
      mounted = false;
    };
  }, [textures]);
  return textures;
}

interface RegionDetail {
  box: DetailBox;
  day: SkImage;
  night: SkImage;
}

let detailCache: RegionDetail | null = null;

/** Sharp NASA imagery around the fitted trip once zoomed in past the bundled textures' resolution. */
function useRegionDetail(stops: GlobeStop[], frame: { lng: number; zoom: number }) {
  const box = frame.zoom < DETAIL_ZOOM ? null : detailBoxFor(stops, frame.lng / DEG, Math.asin(Math.min(1, 1 / (0.9 * frame.zoom))) / DEG);
  const key = box ? `${box.west},${box.south},${box.width},${box.height}` : null;
  const sameBox = (d: RegionDetail | null) => (d && key === `${d.box.west},${d.box.south},${d.box.width},${d.box.height}` ? d : null);
  const [detail, setDetail] = useState<RegionDetail | null>(() => sameBox(detailCache));

  useEffect(() => {
    if (!box || sameBox(detail)) return;
    let mounted = true;
    void getRegionImagery(box).then(async (imagery) => {
      if (!imagery) return;
      const [day, night] = await Promise.all([Skia.Data.fromURI(imagery.dayUri), Skia.Data.fromURI(imagery.nightUri)]);
      const dayImage = Skia.Image.MakeImageFromEncoded(day);
      const nightImage = Skia.Image.MakeImageFromEncoded(night);
      if (!dayImage || !nightImage) return;
      detailCache = { box: imagery.box, day: dayImage, night: nightImage };
      if (mounted) setDetail(detailCache);
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return sameBox(detail);
}

/**
 * Default view: centred on the current stop, zoomed so about `DEFAULT_SPAN_KM` of ground spans the
 * screen width. On the orthographic disc a point θ from the centre sits sin(θ)·R out, and the screen
 * is ~1.25× the square box the radius is sized from.
 */
function frameFocus(focus: GlobeStop) {
  const halfBoxAngle = DEFAULT_SPAN_KM / 2 / 1.25 / EARTH_RADIUS_KM;
  return {
    lat: Math.max(-1.3, Math.min(1.3, focus.latitude * DEG)),
    lng: focus.longitude * DEG,
    zoom: 1 / (0.9 * Math.sin(halfBoxAngle)),
  };
}

/** Same angle shifted by whole turns to be closest to `from`, so the spin takes the short way round. */
function nearestTurn(angle: number, from: number) {
  return angle + Math.round((from - angle) / (2 * Math.PI)) * 2 * Math.PI;
}

// Clear skies until the live cloud grid loads.
const NO_CLOUDS = Skia.Image.MakeImage(
  { width: 1, height: 1, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
  Skia.Data.fromBytes(new Uint8Array([0, 0, 0, 255])),
  4,
)!;

// Orthographic globe: per pixel, find the point on the sphere, rotate it back to world space and
// sample equirectangular NASA imagery: Blue Marble on the day side, Black Marble (moonlit land and
// city lights) on the night side, split by the real sun. Clouds follow live cloud cover from a
// coarse grid; noise only adds the fine structure inside each cell and drifts with the planet's
// wind bands. At night clouds are lit by the real moon phase and live thunderstorm cells flash.
// Outside the disc: a thin sunlit atmosphere over a real photograph of the Milky Way.
const GLOBE = Skia.RuntimeEffect.Make(`
uniform shader day;
uniform shader night;
uniform shader clouds;
uniform shader dayDetail;
uniform shader nightDetail;
uniform float4 detailBox;
uniform float2 detailSize;
uniform float detailOn;
uniform shader sky;
uniform float skyScale;
uniform float2 center;
uniform float radius;
uniform float rotLng;
uniform float rotLat;
uniform float3 sun;
uniform float time;
uniform float moon;

const float PI = 3.14159265;
const float3 ATMO = float3(0.36, 0.6, 1.0);

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

float fbm(float2 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * noise(p);
    p = p * 2.07 + float2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

// Domain-warped fbm reads as streaky weather systems rather than round blobs.
float cloudNoise(float2 p) {
  return fbm(p + 1.8 * fbm(p * 0.5 + float2(time * 0.01, 0.0), 3), 5);
}

// Triplanar noise on the 3D surface point: no seam at the antimeridian and no pinching at the poles.
float sphereNoise(float3 w) {
  float3 k = pow(abs(w), float3(4.0));
  k /= k.x + k.y + k.z;
  float3 p = w * 9.0;
  return cloudNoise(p.yz) * k.x + cloudNoise(p.xz + float2(3.1, 7.7)) * k.y + cloudNoise(p.xy + float2(8.3, 2.9)) * k.z;
}

// Spins a point about the polar axis; positive angles move it east.
float3 rotY(float3 p, float a) {
  float c = cos(a); float s = sin(a);
  return float3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

// Clouds ride the wind bands: trade winds blow west near the equator, westerlies east at mid
// latitudes, polar easterlies west again. Two phases cross-fade so the shear never piles up.
float driftingClouds(float3 w, float lat) {
  const float PERIOD = 36.0;
  float wind = -cos(4.0 * abs(lat)) * 0.009 * PERIOD;
  float ph0 = fract(time / PERIOD);
  float ph1 = fract(time / PERIOD + 0.5);
  float n0 = sphereNoise(rotY(w, -wind * ph0));
  float n1 = sphereNoise(rotY(w, -wind * ph1));
  float k0 = 1.0 - abs(2.0 * ph0 - 1.0);
  float k1 = 1.0 - k0;
  // Variance-preserving blend keeps cloud edges crisp mid fade.
  return (n0 * k0 + n1 * k1 - 0.5) / sqrt(k0 * k0 + k1 * k1) + 0.5;
}

half4 main(float2 p) {
  float2 q = (p - center) / radius;
  float r = length(q);

  float cl = cos(rotLat); float sl = sin(rotLat);
  float cg = cos(rotLng); float sg = sin(rotLng);
  // Sun direction in view space (inverse of the view-to-world rotation below).
  float3 sa = float3(sun.x * cg - sun.z * sg, sun.y, sun.x * sg + sun.z * cg);
  float3 sunV = float3(sa.x, sa.y * cl - sa.z * sl, sa.y * sl + sa.z * cl);

  float facing = dot(normalize(float2(q.x, -q.y) + 0.0001), normalize(sunV.xy + 0.0001));
  float haloLight = 0.25 + 0.75 * smoothstep(-0.5, 0.7, facing);
  float halo = (exp(-(r - 1.0) * 30.0) * 0.55 + exp(-(r - 1.0) * 9.0) * 0.12) * haloLight;
  // Sky: a ray behind the globe, drifting at a quarter of the globe's spin for depth, then tilted so
  // the Milky Way crosses diagonally behind Earth.
  float2 sp = (p - center) / skyScale;
  float3 d = rotY(normalize(float3(sp.x, -sp.y, -1.8)), rotLng * 0.25 + 0.5);
  float pt = rotLat * 0.25 - 0.3;
  d = float3(d.x, d.y * cos(pt) - d.z * sin(pt), d.y * sin(pt) + d.z * cos(pt));
  d = float3(d.x * 0.85 - d.y * 0.53, d.x * 0.53 + d.y * 0.85, d.z);
  float glon = atan(d.x, -d.z);
  float glat = asin(clamp(d.y, -1.0, 1.0));
  float2 suv = float2((glon / (2.0 * PI) + 0.5) * ${SKY_W}.0, (0.5 - glat / PI) * ${SKY_H}.0);
  float3 space = pow(float3(sky.eval(suv).rgb), float3(1.15)) * 0.9;
  float3 back = mix(space, ATMO, clamp(halo, 0.0, 1.0));
  if (r > 1.0) return half4(half3(back), 1.0);

  float z = sqrt(max(0.0, 1.0 - r * r));
  float3 v = float3(q.x, -q.y, z);
  float3 a = float3(v.x, v.y * cl + v.z * sl, -v.y * sl + v.z * cl);
  float3 w = float3(a.x * cg + a.z * sg, a.y, -a.x * sg + a.z * cg);

  float lat = asin(clamp(w.y, -1.0, 1.0));
  float lng = atan(w.x, w.z);
  float2 uv = float2((lng + PI) / (2.0 * PI) * ${TEX_W}.0, (PI * 0.5 - lat) / PI * ${TEX_H}.0);
  float3 dayTex = float3(day.eval(uv).rgb);
  float3 nightTex = float3(night.eval(uv).rgb);

  // Regional high-res imagery (x = west, y = south, z = width, w = height, radians), feathered at its edges.
  float du = mod(lng - detailBox.x, 2.0 * PI) / detailBox.z;
  float dv = (detailBox.y + detailBox.w - lat) / detailBox.w;
  float inBox = step(0.0, du) * step(du, 1.0) * step(0.0, dv) * step(dv, 1.0);
  float feather = smoothstep(0.0, 0.08, min(min(du, 1.0 - du), min(dv, 1.0 - dv))) * inBox * detailOn;
  if (feather > 0.0) {
    float2 duv = float2(du, dv) * detailSize;
    dayTex = mix(dayTex, float3(dayDetail.eval(duv).rgb), feather);
    nightTex = mix(nightTex, float3(nightDetail.eval(duv).rgb), feather);
  }

  float sunDot = dot(w, sun);
  float lit = smoothstep(-0.1, 0.1, sunDot);
  float diffuse = smoothstep(-0.08, 0.7, sunDot);

  float3 dayCol = pow(dayTex, float3(0.9)) * (0.2 + 1.0 * diffuse);
  // Black Marble's city lights are warm, its moonlit land is blue: keep the land dim, boost the lights.
  float warm = (nightTex.r + nightTex.g) * 0.5 - nightTex.b * 0.8;
  float lights = smoothstep(0.02, 0.5, warm) * (0.35 + 0.65 * smoothstep(0.3, 0.9, warm));
  float3 nightCol = min(nightTex, float3(0.35)) * (0.25 + 0.3 * moon) + float3(1.0, 0.74, 0.4) * lights * 1.15;
  float3 col = mix(nightCol, dayCol, lit);

  // Grid cell centres sit at pixel centres; x wraps around the antimeridian.
  float2 cuv = float2((degrees(lng) + 180.0) / ${CLOUD_STEP}.0 + 0.5, (82.5 - degrees(lat)) / ${CLOUD_STEP}.0 + 0.5);
  half4 grid = clouds.eval(cuv);
  float cover = float(grid.r);
  float storm = float(grid.g);
  float n = driftingClouds(w, lat);
  float thresh = mix(0.78, 0.3, cover);
  float density = smoothstep(thresh, thresh + 0.14, n) * smoothstep(0.04, 0.15, cover);
  float cloud = density * 0.95;
  float3 moonCloud = float3(0.5, 0.58, 0.75) * (0.06 + 0.16 * moon) * (0.7 + 0.3 * density);
  float3 cloudCol = float3(0.78 + 0.22 * density) * diffuse + moonCloud * (1.0 - lit);
  col = mix(col, cloudCol, cloud);
  // City lights still glow faintly through cloud.
  col += float3(1.0, 0.78, 0.45) * lights * cloud * (1.0 - lit) * 0.25;

  // Lightning: each 4° cell in a live thunderstorm area fires short, flickering flashes at random.
  float2 lcell = float2(degrees(lng), degrees(lat)) / 4.0;
  float2 lid = floor(lcell);
  float seed = hash(lid);
  float beat = time * 1.3 + seed * 17.0;
  float strike = step(0.9, hash(lid + floor(beat) * 0.37));
  float phase = fract(beat);
  float flicker = exp(-phase * 10.0) * (0.55 + 0.45 * sin(phase * 70.0));
  float2 spot = fract(lcell) - 0.5 - (float2(hash(lid + 3.1), hash(lid + 7.7)) - 0.5) * 0.5;
  float bolt = storm * strike * flicker * smoothstep(0.45, 0.0, length(spot)) * smoothstep(0.2, 0.6, density);
  col += float3(0.78, 0.84, 1.0) * bolt * (1.6 - 1.2 * lit);

  float water = smoothstep(0.05, 0.15, dayTex.b - dayTex.r) * (1.0 - cloud);
  float3 refl = reflect(-sunV, v);
  col += float3(1.0, 0.95, 0.85) * pow(max(refl.z, 0.0), 40.0) * water * lit * 0.4;

  float twilight = exp(-pow((sunDot - 0.02) / 0.07, 2.0));
  col *= mix(float3(1.0), float3(1.25, 0.86, 0.62), twilight * 0.6);

  float fresnel = pow(1.0 - z, 3.0);
  col += ATMO * fresnel * 0.75 * smoothstep(-0.25, 0.4, sunDot);

  float edge = smoothstep(1.0, 1.0 - 1.5 / radius, r);
  return half4(half3(mix(back, col, edge)), 1.0);
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
  contactColor: string;
  accent: string;
  isDark: boolean;
  /** Pinch released past the hand-off zoom: the point under the centre (degrees) and the globe radius in px. */
  onZoomThrough?: (center: { latitude: number; longitude: number }, radiusPx: number) => void;
  /** Start zoomed in on a point (e.g. coming back out of the map) and ease out to the whole globe. */
  entry?: { latitude: number; longitude: number } | null;
  /** Space at the top of the canvas kept for overlaid content; the globe centres below it. */
  topInset?: number;
  /** A finger is on the globe; the page should stop scrolling so drags spin the globe instead. */
  onTouchActive?: (active: boolean) => void;
  /** No trip: show the whole globe, slowly spinning until a stop is picked, never zoomed in. */
  overview?: boolean;
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
 * Photoreal 3D globe drawn in one Skia shader with live clouds, the trip's flight arcs glowing
 * between stops and current weather at the focused stop.
 * On mount it spins and zooms in on the current stop; drag to spin it, pinch out for the route and
 * the whole globe or in to hand off to the map.
 */
export function Globe({ stops, focusIndex, width, height, origin, contacts = [], contactColor, accent, isDark, onZoomThrough, entry, topInset = 0, onTouchActive, overview = false }: GlobeProps) {
  const textures = useGlobeTextures();
  const dayImage = textures?.day ?? null;
  const nightImage = textures?.night ?? null;
  const focusOnly = useMemo(() => (stops[focusIndex] ? [stops[focusIndex]] : []), [focusIndex, stops]);
  const { clouds, stopWeather } = useGlobeWeather(focusOnly);
  const [now, setNow] = useState(() => new Date());
  const sun = sunVector(now);
  const moon = 0.2 + 0.8 * moonIllumination(now);
  const reduceMotion = useReducedMotion();
  const clock = useClock();
  const baseRadius = Math.min(width, height - topInset) * 0.45;
  const focus = stops[focusIndex] ?? { name: "", latitude: 20, longitude: 0 };
  const frame = useMemo(
    () =>
      overview
        ? { lat: Math.max(-0.6, Math.min(0.6, focus.latitude * DEG * 0.8)), lng: focus.longitude * DEG, zoom: MIN_ZOOM }
        : frameFocus(focus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, focus.latitude, focus.longitude],
  );
  const spinning = overview && stops.length === 0 && !reduceMotion;
  const restZoom = frame.zoom;
  const detail = useRegionDetail(focusOnly, frame);
  const detailBox = detail
    ? [detail.box.west * DEG, detail.box.south * DEG, detail.box.width * DEG, detail.box.height * DEG]
    : [0, 0, 1, 1];
  const detailSize = detail ? [detail.day.width(), detail.day.height()] : [1, 1];
  // Hand-off and max zoom sit relative to the fitted view, so a tight trip still needs a real pinch.
  const handoffZoom = Math.max(MIN_HANDOFF_ZOOM, restZoom * 2.2);
  const maxZoom = handoffZoom * 1.4;
  const zoom = useSharedValue(entry ? handoffZoom : reduceMotion ? restZoom : 1);
  const zoomStart = useSharedValue(1);
  const radius = useDerivedValue(() => baseRadius * zoom.get());
  const handoffHinted = useSharedValue(false);
  const fade = useDerivedValue(() => 1 - Math.min(1, Math.max(0, (zoom.get() - handoffZoom) / (maxZoom - handoffZoom))) * 0.6);
  const cx = width / 2;
  const cy = topInset + (height - topInset) / 2;
  const targetLng = frame.lng;
  const targetLat = frame.lat;

  const rotLng = useSharedValue(entry ? entry.longitude * DEG : targetLng - (reduceMotion ? 0 : 2.2));
  const rotLat = useSharedValue(entry ? entry.latitude * DEG : reduceMotion || spinning ? targetLat : 0.1);
  const touching = useSharedValue(false);
  const resumeAt = useSharedValue(0);

  // Overview spin, paused while touched and for a moment after, so drags and momentum aren't fought.
  const spin = useFrameCallback((info) => {
    if (touching.get()) return;
    if (resumeAt.get() < 0) resumeAt.set(info.timestamp + SPIN_RESUME_MS);
    if (info.timestamp < resumeAt.get()) return;
    rotLng.set(rotLng.get() - SPIN_RAD_PER_MS * (info.timeSincePreviousFrame ?? 16));
  }, false);
  useEffect(() => {
    spin.setActive(spinning);
  }, [spin, spinning]);

  // The terminator follows the real sun, so keep the clock fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
    const lng = nearestTurn(targetLng, rotLng.get());
    if (entry) {
      zoom.set(withSpring(restZoom, springs.sheet));
      rotLng.set(withTiming(lng, { duration: 700, easing: ease }));
      rotLat.set(withTiming(targetLat, { duration: 700, easing: ease }));
      return;
    }
    if (spinning) {
      zoom.set(restZoom);
      return;
    }
    if (reduceMotion) {
      zoom.set(restZoom);
      rotLng.set(lng);
      rotLat.set(targetLat);
      return;
    }
    zoom.set(withTiming(restZoom, { duration: 2600, easing: ease }));
    rotLng.set(withTiming(lng, { duration: 2600, easing: ease }));
    rotLat.set(withTiming(targetLat, { duration: 2600, easing: ease }));
  }, [entry, reduceMotion, restZoom, rotLat, rotLng, spinning, targetLat, targetLng, zoom]);

  const uniforms = useDerivedValue(() => ({
    center: [cx, cy],
    radius: radius.get(),
    rotLng: rotLng.get(),
    rotLat: rotLat.get(),
    skyScale: Math.min(width, height - topInset) / 2,
    sun,
    time: clock.get() / 1000,
    moon,
    detailBox,
    detailSize,
    detailOn: detail ? 1 : 0,
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
    if (origin && stops.length > 0) traceArc(builder, origin, focus);
  });

  const cometEnd = useDerivedValue(() => (clock.get() % 2600) / 2600);
  const cometStart = useDerivedValue(() => Math.max(0, cometEnd.get() - 0.18));
  const pulse = useDerivedValue(() => (clock.get() % 1600) / 1600);

  const pins = useMemo(() => stops.map((stop, i) => ({ stop, focused: i === focusIndex })), [focusIndex, stops]);

  // Drags in any direction spin the globe; the parent pauses its scroll while a finger is down.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .minDistance(6)
    .onBegin(() => {
      touching.set(true);
    })
    .onFinalize(() => {
      touching.set(false);
      resumeAt.set(-1);
    })
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
      touching.set(true);
    })
    .onFinalize(() => {
      touching.set(false);
      resumeAt.set(-1);
    })
    .onUpdate((event) => {
      // Pinches cover more ground the further in you are, so the whole globe is a pinch or two away.
      const start = zoomStart.get();
      const next = start * Math.pow(event.scale, 1 + 0.8 * Math.log10(Math.max(1, start)));
      if (next >= handoffZoom !== handoffHinted.get()) {
        handoffHinted.set(next >= handoffZoom);
        if (next >= handoffZoom) scheduleOnRN(selectionChanged);
      }
      zoom.set(next < MIN_ZOOM ? MIN_ZOOM - (MIN_ZOOM - next) * 0.3 : next > maxZoom ? maxZoom + (next - maxZoom) * 0.3 : next);
    })
    .onEnd(() => {
      if (onZoomThrough && zoom.get() >= handoffZoom) {
        // The point under the view's centre is (rotLat, rotLng) by construction of the projection.
        const center = { latitude: rotLat.get() / DEG, longitude: (((rotLng.get() / DEG + 540) % 360) - 180) };
        scheduleOnRN(onZoomThrough, center, baseRadius * zoom.get());
        return;
      }
      zoom.set(withSpring(Math.min(maxZoom, Math.max(MIN_ZOOM, zoom.get())), springs.sheet));
    });

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <View
        style={{ width, height }}
        onTouchStart={() => onTouchActive?.(true)}
        onTouchEnd={() => onTouchActive?.(false)}
        onTouchCancel={() => onTouchActive?.(false)}
      >
        {textures && dayImage && nightImage ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Group opacity={fade}>
            <Fill>
              <Shader source={GLOBE} uniforms={uniforms}>
                <ImageShader image={dayImage} fit="fill" x={0} y={0} width={TEX_W} height={TEX_H} sampling={SMOOTH} />
                <ImageShader image={nightImage} fit="fill" x={0} y={0} width={TEX_W} height={TEX_H} sampling={SMOOTH} />
                <ImageShader
                  image={clouds ?? NO_CLOUDS}
                  fit="fill"
                  x={0}
                  y={0}
                  width={CLOUD_COLS}
                  height={CLOUD_ROWS}
                  tx="repeat"
                  ty="clamp"
                  sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
                />
                <ImageShader
                  image={detail?.day ?? NO_CLOUDS}
                  fit="fill"
                  x={0}
                  y={0}
                  width={detailSize[0]}
                  height={detailSize[1]}
                  sampling={SMOOTH}
                />
                <ImageShader
                  image={detail?.night ?? NO_CLOUDS}
                  fit="fill"
                  x={0}
                  y={0}
                  width={detailSize[0]}
                  height={detailSize[1]}
                  sampling={SMOOTH}
                />
                <ImageShader image={textures.sky} fit="fill" x={0} y={0} width={SKY_W} height={SKY_H} tx="repeat" ty="clamp" sampling={SMOOTH} />
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
        {dayImage && nightImage && focusOnly[0] && stopWeather[0] ? (
          <WeatherBadge
            key={`weather-${focusOnly[0].name}`}
            stop={focusOnly[0]}
            weather={stopWeather[0]}
            rotLng={rotLng}
            rotLat={rotLat}
            cx={cx}
            cy={cy}
            radius={radius}
            fade={fade}
          />
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

function WeatherBadge({
  stop,
  weather,
  rotLng,
  rotLat,
  cx,
  cy,
  radius,
  fade,
}: {
  stop: GlobeStop;
  weather: StopWeather;
  rotLng: ReturnType<typeof useSharedValue<number>>;
  rotLat: ReturnType<typeof useSharedValue<number>>;
  cx: number;
  cy: number;
  radius: ReturnType<typeof useDerivedValue<number>>;
  fade: ReturnType<typeof useDerivedValue<number>>;
}) {
  const { c, f } = useAura();
  const unit = useTemperatureUnit();
  // Sits up and to the right of the pin; fades out as the stop turns toward the limb.
  const style = useAnimatedStyle(() => {
    const point = project(stop.latitude * DEG, stop.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, radius.get());
    return {
      opacity: Math.min(1, Math.max(0, (point.z - 0.15) / 0.2)) * (fade.get() - 0.4) / 0.6,
      transform: [{ translateX: point.x + 9 }, { translateY: point.y - 30 }],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.badge, { backgroundColor: c.surfaceStrong, borderColor: c.hairline }, style]}>
      <Text style={styles.badgeEmoji}>{weather.emoji}</Text>
      <Text style={[styles.badgeText, { color: c.text, fontFamily: f.semibold }]}>{`${toUnit(weather.temperature, unit)}°`}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute",
    left: 0,
    top: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeEmoji: { fontSize: 11 },
  badgeText: { fontSize: 12 },
});
