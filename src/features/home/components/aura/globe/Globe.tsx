import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import {
  AlphaType,
  Canvas,
  DashPathEffect,
  Circle,
  ColorType,
  FilterMode,
  Fill,
  ImageShader,
  MipmapMode,
  Path,
  Shader,
  Skia,
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
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { springs, useAura } from "@/atoms";
import { useAnimationsActive } from "@/hooks/useAnimationsActive";
import { useGlobeWeather } from "@/features/home/hooks/useGlobeWeather";
import { GLOBE_MAX_TILES, getRegionImagery, prefetchRegionImagery } from "@/features/home/services/globeImagery";
import { tileBoxFor, tileBoxKey, type DetailBox, type TileBox } from "@/features/home/utils/globeTiles";
import { CLOUD_COLS, CLOUD_ROWS, CLOUD_STEP, type StopWeather } from "@/features/home/services/globeWeather";
import { selectionChanged } from "@/utils/haptics";
import { useLocalization } from "@/localization";
import { distanceKm, moonIllumination, sunVector } from "./sun";

// NASA Visible Earth (public domain): Blue Marble Next Generation (Sep 2004, least seasonal snow) and Black Marble 2016.
const DAY_TEXTURE = require("../../../../../../assets/images/globe/earth-day.jpg");
const NIGHT_TEXTURE = require("../../../../../../assets/images/globe/earth-night.jpg");
// ESO/S. Brunier, CC BY 4.0 (credited in Settings): the whole Milky Way in galactic coordinates.
const SKY_TEXTURE = require("../../../../../../assets/images/globe/milky-way.jpg");

const MIN_ZOOM = 1;
const DEFAULT_SPAN_KM = 400;
const MIN_ROUTE_KM = 500;
// The fitted route view keeps every stop within this share of the clear window's half width / half height.
const ROUTE_FIT = 0.85;
// Sharp imagery reaches this far past a stop, a little more than the focused view shows, so a drag stays sharp.
const FOCUS_MARGIN_DEG = 2;
// Overview spin: one turn every 2.5 minutes, eastward like the real Earth.
const SPIN_RAD_PER_MS = (2 * Math.PI) / 150_000;
const SPIN_RESUME_MS = 2000;
// The globe redraws at ~30 fps rather than the display rate: clouds drift slowly and the comet and pin
// pulses still read smoothly. It's one canvas on purpose: two full-size Skia surfaces created together
// crash the Adreno Vulkan driver under Graphite (Snapdragon phones).
const SHADER_TICK_MS = 33;
const EARTH_RADIUS_KM = 6371;
const MIN_HANDOFF_ZOOM = 3.2;
const TEX_W = 2048;
const TEX_H = 1024;
const SKY_W = 2048;
const SKY_H = 1024;
const DEG = Math.PI / 180;
// Horizon strip: a globe wider than the screen, its centre below the strip so only the top arc shows,
// tilted so the focused stop sits just under the edge.
const HORIZON_RADIUS = 1.15;
const HORIZON_TILT = 1.2;
const HORIZON_EDGE = 0.32;
// Angular margin (radians, ~4.5°) of the night light past the outermost stop.
const GLOW_MARGIN = 0.08;
// The focused pin sends out one soft ring this often.
const PULSE_MS = 2400;
// Route legs: dash and gap (px) and how far the dashes on the next leg travel per second.
const DASH = [6, 6];
const MARCH_PX_PER_S = 9;
// Each leg bows sideways by this share of its length, so a return leg never sits on the outbound one.
const LEG_BEND = 0.1;
// Gap (px) between a leg's end and the centre of its pin, and the shortest leg still worth drawing.
const PIN_TRIM_PX = 8;
const FOCUS_TRIM_PX = 13;
const MIN_LEG_PX = 6;
// A stop's pin is dropped when it would sit this close (px) to a more important one.
const PIN_MERGE_PX = 9;
// Room under the lowest stop for its name, kept clear of the bottom fade when framing the route.
const LABEL_ROOM = 18;
const LABEL_WIDTH = 180;
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

const regionCache = new Map<string, RegionDetail>();

async function loadRegion(tiles: TileBox) {
  const key = tileBoxKey(tiles);
  const cached = regionCache.get(key);
  if (cached) return cached;
  const imagery = await getRegionImagery(tiles);
  if (!imagery) return null;
  const [day, night] = await Promise.all([Skia.Data.fromURI(imagery.dayUri), Skia.Data.fromURI(imagery.nightUri)]);
  const dayImage = Skia.Image.MakeImageFromEncoded(day);
  const nightImage = Skia.Image.MakeImageFromEncoded(night);
  if (!dayImage || !nightImage) return null;
  const detail = { box: imagery.box, day: dayImage, night: nightImage };
  regionCache.set(key, detail);
  return detail;
}

/** Margin around the route box: the fitted route view shows about a third of the spread beyond the outer stops. */
function routeMargin(stops: GlobeStop[]) {
  const ref = stops[0]?.longitude ?? 0;
  const rel = stops.map((s) => ((((s.longitude - ref) % 360) + 540) % 360) - 180);
  const lats = stops.map((s) => s.latitude);
  return Math.max(FOCUS_MARGIN_DEG, 0.35 * Math.max(Math.max(...rel) - Math.min(...rel), Math.max(...lats) - Math.min(...lats)));
}

/**
 * Sharp NASA imagery for the whole route, with the focused stop's sharper box on top. Only those two
 * stay decoded; the other stops' boxes are downloaded in the background so switching days is instant.
 */
function useTripImagery(stops: GlobeStop[], focusIndex: number, enabled: boolean) {
  const route = useMemo(() => (enabled && stops.length > 1 ? tileBoxFor(stops, routeMargin(stops), GLOBE_MAX_TILES) : null), [enabled, stops]);
  const stopBoxes = useMemo(() => (enabled ? stops.map((stop) => tileBoxFor([stop], FOCUS_MARGIN_DEG, GLOBE_MAX_TILES)) : []), [enabled, stops]);
  const focus = stopBoxes[focusIndex] ?? null;
  const routeKey = route ? tileBoxKey(route) : null;
  const focusKey = focus ? tileBoxKey(focus) : null;
  const [regions, setRegions] = useState<Record<string, RegionDetail>>(() => Object.fromEntries(regionCache));

  useEffect(() => {
    const wanted = [focus, route].filter((box): box is TileBox => box !== null);
    if (!wanted.length) return;
    const wantedKeys = wanted.map(tileBoxKey);
    for (const key of [...regionCache.keys()]) if (!wantedKeys.includes(key)) regionCache.delete(key);
    let mounted = true;
    void (async () => {
      for (const tiles of wanted) {
        const detail = await loadRegion(tiles);
        if (!mounted) return;
        if (detail) {
          setRegions((prev) => ({
            ...Object.fromEntries(Object.entries(prev).filter(([key]) => wantedKeys.includes(key))),
            [tileBoxKey(tiles)]: detail,
          }));
        }
      }
      void prefetchRegionImagery(stopBoxes.filter((box, i): box is TileBox => box !== null && i !== focusIndex));
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, focusKey]);

  return {
    route: routeKey ? (regions[routeKey] ?? null) : null,
    focus: focusKey ? (regions[focusKey] ?? null) : null,
  };
}

/** The point (radians) that `project` puts at unit offset (x, y) from the centre of a view centred on (lat, lng). */
function unproject(x: number, y: number, lat: number, lng: number) {
  const vy = -y;
  const vz = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  const ay = vy * Math.cos(lat) + vz * Math.sin(lat);
  const az = -vy * Math.sin(lat) + vz * Math.cos(lat);
  const wx = x * Math.cos(lng) + az * Math.sin(lng);
  const wz = -x * Math.sin(lng) + az * Math.cos(lng);
  return { lat: Math.max(-1.3, Math.min(1.3, Math.asin(Math.max(-1, Math.min(1, ay))))), lng: Math.atan2(wx, wz) };
}

/**
 * Default view: centred on the current stop, zoomed so about `DEFAULT_SPAN_KM` of ground spans the
 * screen width. On the orthographic disc a point θ from the centre sits sin(θ)·R out, and the screen
 * is ~1.25× the square box the radius is sized from. `liftPx` raises the stop above the globe's centre.
 */
function frameFocus(focus: GlobeStop, baseRadius = 1, liftPx = 0) {
  const halfBoxAngle = DEFAULT_SPAN_KM / 2 / 1.25 / EARTH_RADIUS_KM;
  const zoom = 1 / (0.9 * Math.sin(halfBoxAngle));
  const lat = Math.max(-1.3, Math.min(1.3, focus.latitude * DEG));
  const lng = focus.longitude * DEG;
  return liftPx ? { ...unproject(0, liftPx / (baseRadius * zoom), lat, lng), zoom } : { lat, lng, zoom };
}

/** The stops' mean direction (radians). */
function meanCenter(stops: GlobeStop[]) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const stop of stops) {
    const la = stop.latitude * DEG;
    const lo = stop.longitude * DEG;
    x += Math.cos(la) * Math.sin(lo);
    y += Math.sin(la);
    z += Math.cos(la) * Math.cos(lo);
  }
  return { lat: Math.atan2(y, Math.hypot(x, z)), lng: Math.atan2(x, z) };
}

/**
 * Fits every stop inside `ROUTE_FIT` of the view's half width and of the half height of the clear
 * window (`halfH`), centring their bounding box `liftPx` above the globe's centre, i.e. in that window.
 */
function frameRoute(stops: GlobeStop[], baseRadius: number, halfW: number, halfH: number, liftPx: number) {
  const { lat, lng } = meanCenter(stops);
  const pts = stops.map((stop) => project(stop.latitude * DEG, stop.longitude * DEG, lng, lat, 0, 0, 1));
  if (pts.some((pt) => pt.z <= 0.05)) return { lat: Math.max(-1.3, Math.min(1.3, lat)), lng, zoom: MIN_ZOOM };
  const xs = pts.map((pt) => pt.x);
  const ys = pts.map((pt) => pt.y);
  const minSpan = Math.sin(MIN_ROUTE_KM / EARTH_RADIUS_KM);
  const spanX = Math.max(minSpan, (Math.max(...xs) - Math.min(...xs)) / 2);
  const spanY = Math.max(minSpan, (Math.max(...ys) - Math.min(...ys)) / 2);
  const fit = Math.min((ROUTE_FIT * halfW) / (baseRadius * spanX), (ROUTE_FIT * halfH) / (baseRadius * spanY));
  const zoom = Math.min(frameFocus(stops[0]).zoom, Math.max(MIN_ZOOM, fit));
  const mx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const my = (Math.max(...ys) + Math.min(...ys)) / 2;
  return { ...unproject(mx, my + liftPx / (baseRadius * zoom), lat, lng), zoom };
}

/** Direction (unit vector) and cosines of the inner/outer edge of the soft night light around the trip's stops. */
function tripGlow(stops: GlobeStop[]) {
  if (stops.length === 0) return { dir: [0, 0, 1], cos: [1, 1], on: 0 };
  const { lat, lng } = meanCenter(stops);
  const center = { latitude: lat / DEG, longitude: lng / DEG };
  const reach = Math.max(...stops.map((stop) => distanceKm(center, stop))) / EARTH_RADIUS_KM;
  const inner = Math.min(0.6, reach + GLOW_MARGIN);
  const outer = inner + Math.max(GLOW_MARGIN, inner * 0.6);
  return { dir: [Math.cos(lat) * Math.sin(lng), Math.sin(lat), Math.cos(lat) * Math.cos(lng)], cos: [Math.cos(inner), Math.cos(outer)], on: 1 };
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
uniform shader routeDay;
uniform shader routeNight;
uniform float4 routeBox;
uniform float2 routeSize;
uniform float routeOn;
uniform shader focusDay;
uniform shader focusNight;
uniform float4 focusBox;
uniform float2 focusSize;
uniform float focusOn;
uniform shader sky;
uniform float skyScale;
uniform float2 center;
uniform float radius;
uniform float rotLng;
uniform float rotLat;
uniform float3 sun;
uniform float time;
uniform float moon;
uniform float3 glowDir;
uniform float2 glowCos;
uniform float glowOn;

const float PI = 3.14159265;
const float3 ATMO = float3(0.36, 0.6, 1.0);

// sin()-free hash (Dave Hoskins): many Android GPUs evaluate sin() of large values with low
// precision, which turns the classic fract(sin(...)) hash into visible square blocks.
float hash(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

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

// Position inside a high-res box (x = west, y = south, z = width, w = height, radians) and how much
// of it to show there, feathered at its edges.
float3 boxUv(float lng, float lat, float4 box, float on) {
  float du = mod(lng - box.x, 2.0 * PI) / box.z;
  float dv = (box.y + box.w - lat) / box.w;
  float inBox = step(0.0, du) * step(du, 1.0) * step(0.0, dv) * step(dv, 1.0);
  return float3(du, dv, smoothstep(0.0, 0.08, min(min(du, 1.0 - du), min(dv, 1.0 - dv))) * inBox * on);
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

  // Regional NASA imagery: the whole route, then the focused stop's sharper box on top.
  float3 rb = boxUv(lng, lat, routeBox, routeOn);
  if (rb.z > 0.0) {
    float2 ruv = rb.xy * routeSize;
    dayTex = mix(dayTex, float3(routeDay.eval(ruv).rgb), rb.z);
    nightTex = mix(nightTex, float3(routeNight.eval(ruv).rgb), rb.z);
  }
  float3 fb = boxUv(lng, lat, focusBox, focusOn);
  if (fb.z > 0.0) {
    float2 fuv = fb.xy * focusSize;
    dayTex = mix(dayTex, float3(focusDay.eval(fuv).rgb), fb.z);
    nightTex = mix(nightTex, float3(focusNight.eval(fuv).rgb), fb.z);
  }

  float sunDot = dot(w, sun);
  float lit = smoothstep(-0.1, 0.1, sunDot);
  float diffuse = smoothstep(-0.08, 0.7, sunDot);

  float3 dayCol = pow(dayTex, float3(0.9)) * (0.2 + 1.0 * diffuse);
  // Black Marble's city lights are warm, its moonlit land is blue: keep the land dim, boost the lights.
  float warm = (nightTex.r + nightTex.g) * 0.5 - nightTex.b * 0.8;
  float lights = smoothstep(0.02, 0.5, warm) * (0.35 + 0.65 * smoothstep(0.3, 0.9, warm));
  float3 nightCol = min(nightTex, float3(0.35)) * (0.25 + 0.3 * moon) + float3(1.0, 0.74, 0.4) * lights * 1.15;
  // Around the trip, moonlight the day imagery so coasts and land stay readable after dark.
  float tripLight = glowOn * smoothstep(glowCos.y, glowCos.x, dot(w, glowDir));
  float3 moonLand = mix(float3(dot(dayTex, float3(0.3, 0.59, 0.11))), dayTex, 0.35) * float3(0.62, 0.72, 0.95) * (0.3 + 0.15 * moon);
  nightCol += moonLand * tripLight;
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
  float3 moonCloud = float3(0.5, 0.58, 0.75) * (0.06 + 0.16 * moon) * (0.7 + 0.3 * density) * (1.0 + 1.2 * tripLight);
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
  /** Places of planned trips: hollow dashed rings, since nothing is booked there yet. */
  plannedPins?: GlobeStop[];
  contactColor: string;
  accent: string;
  isDark: boolean;
  /** Pinch released past the hand-off zoom: the point under the centre (degrees) and the globe radius in px. */
  onZoomThrough?: (center: { latitude: number; longitude: number }, radiusPx: number) => void;
  /** Start zoomed in on a point (e.g. coming back out of the map) and ease out to the whole globe. */
  entry?: { latitude: number; longitude: number } | null;
  /** Space at the top of the canvas kept for overlaid content; the globe centres below it. */
  topInset?: number;
  /** A pinch is in progress; the page should stop scrolling until it ends. */
  onTouchActive?: (active: boolean) => void;
  /** True while the parent is scrolling; the globe holds still so scroll frames aren't dropped. */
  scrolling?: SharedValue<boolean>;
  /** No trip: show the whole globe, slowly spinning until a stop is picked, never zoomed in. */
  overview?: boolean;
  /** Open on the whole route, every stop on screen, rather than zoomed in on the focused stop. */
  showRoute?: boolean;
  /** Draw only the globe's top arc as a short strip; pinch is off and a tap calls `onPress`. */
  horizon?: boolean;
  onPress?: () => void;
  /**
   * How far along the trip is. Travelled legs and the next one are bright, the rest faint:
   * "planned" lights the first leg, "live" the legs up to the focused stop and the one after it
   * (visited stops dim), "done" (default) every leg.
   */
  routeState?: "planned" | "live" | "done";
  /** Name every stop under its pin; names that would overlap a more important one are hidden. */
  labelStops?: boolean;
  /** Height at the bottom of the canvas covered by the page's fade; the route is framed above it. */
  bottomInset?: number;
}

/** Per trip stop: whether its pin is drawn, and its name's [shown, x offset, y offset] from the pin. */
interface StopLayout {
  pinOn: number[];
  labels: number[][];
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

/** Point along the great circle from a to b (0..1), bowed sideways (to the left of travel) and kept on the surface. */
function legPoint(a: GlobeStop, b: GlobeStop, t: number) {
  "worklet";
  const la = a.latitude * DEG;
  const lo = a.longitude * DEG;
  const lb = b.latitude * DEG;
  const ob = b.longitude * DEG;
  const va = [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
  const vb = [Math.cos(lb) * Math.sin(ob), Math.sin(lb), Math.cos(lb) * Math.cos(ob)];
  const omega = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const s = Math.sin(omega);
  if (s < 1e-6) return { lat: la, lng: lo };
  const k1 = Math.sin((1 - t) * omega) / s;
  const k2 = Math.sin(t * omega) / s;
  // The normal a × b points left of the direction of travel; offsetting along it bows the leg.
  const bend = (Math.sin(Math.PI * t) * LEG_BEND * omega) / s;
  const x = va[0] * k1 + vb[0] * k2 + (va[1] * vb[2] - va[2] * vb[1]) * bend;
  const y = va[1] * k1 + vb[1] * k2 + (va[2] * vb[0] - va[0] * vb[2]) * bend;
  const z = va[2] * k1 + vb[2] * k2 + (va[0] * vb[1] - va[1] * vb[0]) * bend;
  const len = Math.sqrt(x * x + y * y + z * z);
  return { lat: Math.asin(y / len), lng: Math.atan2(x, z) };
}

/**
 * Photoreal 3D globe drawn in one Skia shader with live clouds, the trip's flight arcs glowing
 * between stops and current weather at the focused stop.
 * On mount it spins and zooms in on the current stop; drag to spin it, pinch out for the route and
 * the whole globe or in to hand off to the map.
 */
export function Globe({ stops, focusIndex, width, height, origin, contacts = [], plannedPins = [], contactColor, accent, isDark, onZoomThrough, entry, topInset = 0, onTouchActive, scrolling, overview = false, showRoute = false, horizon = false, onPress, routeState = "done", labelStops = false, bottomInset = 0 }: GlobeProps) {
  const textures = useGlobeTextures();
  const dayImage = textures?.day ?? null;
  const nightImage = textures?.night ?? null;
  const focusOnly = useMemo(() => (stops[focusIndex] ? [stops[focusIndex]] : []), [focusIndex, stops]);
  const { clouds, stopWeather } = useGlobeWeather(focusOnly);
  const [now, setNow] = useState(() => new Date());
  const sun = sunVector(now);
  const moon = 0.2 + 0.8 * moonIllumination(now);
  const reduceMotion = useReducedMotion();
  const animating = useAnimationsActive();
  const clock = useSharedValue(0);
  const shaderTime = useSharedValue(0);
  const shaderTickAt = useSharedValue(0);
  const baseRadius = horizon ? width * HORIZON_RADIUS : Math.min(width, height - topInset) * 0.45;
  const focus = stops[focusIndex] ?? { name: "", latitude: 20, longitude: 0 };
  // The clear window: below the overlaid header, above the page's bottom fade (and the lowest name).
  const hiddenBottom = bottomInset + (labelStops ? LABEL_ROOM : 0);
  const clearHalfH = (height - topInset - hiddenBottom) / 2;
  const frameLift = hiddenBottom / 2;
  const frame = useMemo(
    () =>
      horizon
        ? { lat: Math.max(-1.3, Math.min(1.3, focus.latitude * DEG)) - HORIZON_TILT, lng: focus.longitude * DEG, zoom: MIN_ZOOM }
        : overview
        ? { lat: Math.max(-0.6, Math.min(0.6, focus.latitude * DEG * 0.8)), lng: focus.longitude * DEG, zoom: MIN_ZOOM }
        : showRoute && stops.length > 0
          ? frameRoute(stops, baseRadius, width / 2, clearHalfH, frameLift)
          : frameFocus(focus, baseRadius, frameLift),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [horizon, overview, showRoute, stops, focus.latitude, focus.longitude, baseRadius, width, clearHalfH, frameLift],
  );
  const spinning = overview && stops.length === 0 && !reduceMotion;
  const restZoom = frame.zoom;
  const imagery = useTripImagery(stops, focusIndex, !overview);
  const glow = useMemo(() => tripGlow(overview ? [] : stops), [overview, stops]);
  const boxUniform = (d: RegionDetail | null) => (d ? [d.box.west * DEG, d.box.south * DEG, d.box.width * DEG, d.box.height * DEG] : [0, 0, 1, 1]);
  const sizeOf = (d: RegionDetail | null) => (d ? [d.day.width(), d.day.height()] : [1, 1]);
  const routeBox = boxUniform(imagery.route);
  const routeSize = sizeOf(imagery.route);
  const focusBox = boxUniform(imagery.focus);
  const focusSize = sizeOf(imagery.focus);
  // Hand-off and max zoom sit relative to the fitted view, so a tight trip still needs a real pinch.
  const handoffZoom = Math.max(MIN_HANDOFF_ZOOM, restZoom * 2.2);
  const maxZoom = handoffZoom * 1.4;
  const zoom = useSharedValue(entry ? handoffZoom : reduceMotion ? restZoom : 1);
  const zoomStart = useSharedValue(1);
  const radius = useDerivedValue(() => baseRadius * zoom.get());
  const handoffHinted = useSharedValue(false);
  const fade = useDerivedValue(() => 1 - Math.min(1, Math.max(0, (zoom.get() - handoffZoom) / (maxZoom - handoffZoom))) * 0.6);
  const cx = width / 2;
  const cy = horizon ? topInset + (height - topInset) * HORIZON_EDGE + baseRadius : topInset + (height - topInset) / 2;
  const targetLng = frame.lng;
  const targetLat = frame.lat;

  const rotLng = useSharedValue(entry ? entry.longitude * DEG : targetLng - (reduceMotion ? 0 : 2.2));
  const rotLat = useSharedValue(entry ? entry.latitude * DEG : reduceMotion || spinning ? targetLat : 0.1);
  const touching = useSharedValue(false);
  const resumeAt = useSharedValue(0);

  // One clock for clouds, comet, the pin halo and the overview spin, advanced in ~30 fps ticks. It only
  // runs while the globe is visible and holds still during page scrolls.
  const ticker = useFrameCallback((info) => {
    if (scrolling?.get()) return;
    const elapsed = shaderTickAt.get() + (info.timeSincePreviousFrame ?? 16);
    if (elapsed < SHADER_TICK_MS) {
      shaderTickAt.set(elapsed);
      return;
    }
    const step = elapsed;
    shaderTickAt.set(0);
    clock.set(clock.get() + step);
    if (!reduceMotion) shaderTime.set(clock.get() / 1000);
    // Overview spin, paused while touched and for a moment after, so drags and momentum aren't fought.
    if (!spinning || touching.get()) return;
    if (resumeAt.get() < 0) resumeAt.set(info.timestamp + SPIN_RESUME_MS);
    if (info.timestamp < resumeAt.get()) return;
    rotLng.set(rotLng.get() - SPIN_RAD_PER_MS * step);
  }, false);
  useEffect(() => {
    ticker.setActive(animating && (!reduceMotion || spinning));
  }, [animating, reduceMotion, spinning, ticker]);

  // The terminator follows the real sun, so keep the clock fresh.
  useEffect(() => {
    if (!animating) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [animating]);

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
    time: shaderTime.get(),
    moon,
    glowDir: glow.dir,
    glowCos: glow.cos,
    glowOn: glow.on,
    routeBox,
    routeSize,
    routeOn: imagery.route ? 1 : 0,
    focusBox,
    focusSize,
    focusOn: imagery.focus ? 1 : 0,
  }));

  // Leg i stops short of both pins, so lines never run into them; a leg too short to clear them is skipped.
  const traceLeg = (builder: SkPathBuilder, i: number) => {
    "worklet";
    const a = stops[i];
    const b = stops[i + 1];
    const r = radius.get();
    const pa = project(a.latitude * DEG, a.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, r);
    const pb = project(b.latitude * DEG, b.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, r);
    const trimA = i === focusIndex ? FOCUS_TRIM_PX : PIN_TRIM_PX;
    const trimB = i + 1 === focusIndex ? FOCUS_TRIM_PX : PIN_TRIM_PX;
    if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < trimA + trimB + MIN_LEG_PX) return;
    let drawing = false;
    for (let s = 0; s <= 48; s += 1) {
      const pt = legPoint(a, b, s / 48);
      const pr = project(pt.lat, pt.lng, rotLng.get(), rotLat.get(), cx, cy, r);
      if (pr.z < -0.02 || Math.hypot(pr.x - pa.x, pr.y - pa.y) < trimA || Math.hypot(pr.x - pb.x, pr.y - pb.y) < trimB) {
        drawing = false;
        continue;
      }
      if (!drawing) builder.moveTo(pr.x, pr.y);
      else builder.lineTo(pr.x, pr.y);
      drawing = true;
    }
  };
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
  // The next leg (its dashes march towards the next stop), unless the trip is over.
  const nextLeg = routeState === "done" ? -1 : routeState === "planned" ? 0 : focusIndex;
  const isBright = (leg: number) => {
    "worklet";
    return routeState === "done" || (routeState === "live" && leg < focusIndex);
  };
  const brightLegs = usePathValue((builder) => {
    "worklet";
    for (let i = 0; i < stops.length - 1; i += 1) if (i !== nextLeg && isBright(i)) traceLeg(builder, i);
  });
  const faintLegs = usePathValue((builder) => {
    "worklet";
    for (let i = 0; i < stops.length - 1; i += 1) if (i !== nextLeg && !isBright(i)) traceLeg(builder, i);
  });
  const nextPath = usePathValue((builder) => {
    "worklet";
    if (nextLeg >= 0 && nextLeg < stops.length - 1) traceLeg(builder, nextLeg);
  });
  const homeArc = usePathValue((builder) => {
    "worklet";
    if (origin && stops.length > 0) traceArc(builder, origin, focus);
  });

  const dashCycle = DASH[0] + DASH[1];
  const march = useDerivedValue(() => dashCycle - ((clock.get() / 1000) * MARCH_PX_PER_S) % dashCycle);
  const pulse = useDerivedValue(() => (clock.get() % PULSE_MS) / PULSE_MS);

  const pins = useMemo(
    () => stops.map((stop, i) => ({ stop, focused: i === focusIndex, visited: routeState === "live" && i < focusIndex })),
    [focusIndex, routeState, stops],
  );

  // Pins and names are laid out most important first (the focused stop, then trip order). A pin that
  // would sit on one already drawn is dropped; a name goes on the side of its pin facing away from the
  // route, or another free side, and is hidden if none is free, until a zoom pulls things apart.
  const labelWidths = useSharedValue<number[]>([]);
  const labelOrder = useMemo(() => [focusIndex, ...stops.map((_, i) => i).filter((i) => i !== focusIndex)], [focusIndex, stops]);
  const hasBadge = Boolean(stopWeather[0]);
  const stopLayout = useDerivedValue(() => {
    const pinOn = stops.map(() => 1);
    const labels = stops.map(() => [0, 0, 0]);
    const points = stops.map((stop) => project(stop.latitude * DEG, stop.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, radius.get()));
    const kept: number[] = [];
    for (const i of labelOrder) {
      const pt = points[i];
      if (pt.z <= 0) continue;
      if (i !== focusIndex && kept.some((j) => Math.hypot(points[j].x - pt.x, points[j].y - pt.y) < PIN_MERGE_PX)) {
        pinOn[i] = 0;
        continue;
      }
      kept.push(i);
    }
    if (!labelStops || horizon) return { pinOn, labels };
    const overlaps = (a: number[], b: number[]) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
    const pinBoxes = kept.map((j) => ({ j, box: [points[j].x - 6, points[j].y - 6, 12, 12] }));
    const placed: number[][] = [];
    const fp = points[focusIndex];
    if (hasBadge && fp && fp.z > 0) placed.push([fp.x + 9, fp.y - 30, 70, 24]);
    for (const i of labelOrder) {
      const w = labelWidths.get()[i];
      const pt = points[i];
      if (!w || !pinOn[i] || pt.z < 0.15) continue;
      const focused = i === focusIndex;
      const h = labelHeight(focused);
      const gap = labelGap(focused);
      let ax = 0;
      let ay = 0;
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= stops.length || points[j].z <= 0) continue;
        const d = Math.hypot(points[j].x - pt.x, points[j].y - pt.y);
        if (d < 1) continue;
        ax -= (points[j].x - pt.x) / d;
        ay -= (points[j].y - pt.y) / d;
      }
      // [direction x, direction y, offset x, offset y]: below, above, right, left.
      const sides = [
        [0, 1, -w / 2, gap],
        [0, -1, -w / 2, -gap - h],
        [1, 0, gap, -h / 2],
        [-1, 0, -gap - w, -h / 2],
      ].sort((a, b) => b[0] * ax + b[1] * ay - (a[0] * ax + a[1] * ay));
      let pick: number[] | null = null;
      for (const side of sides) {
        const box = [pt.x + side[2] - 3, pt.y + side[3] - 2, w + 6, h + 4];
        if (placed.some((o) => overlaps(box, o)) || pinBoxes.some((o) => o.j !== i && overlaps(box, o.box))) continue;
        pick = side;
        break;
      }
      if (!pick && focused) pick = sides[0];
      if (!pick) continue;
      labels[i] = [1, pick[2], pick[3]];
      placed.push([pt.x + pick[2] - 3, pt.y + pick[3] - 2, w + 6, h + 4]);
    }
    return { pinOn, labels };
  });
  // Kept on the JS side too: several labels lay out in the same frame, before the shared value updates.
  const measuredWidths = useRef<number[]>([]);
  const onLabelWidth = (index: number, w: number) => {
    measuredWidths.current[index] = w;
    labelWidths.set([...measuredWidths.current]);
  };

  // Horizontal drags spin the globe (and may then tilt it); vertical swipes are left to the page scroll.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
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
    .onStart(() => {
      if (onTouchActive) scheduleOnRN(onTouchActive, true);
    })
    .onFinalize(() => {
      touching.set(false);
      resumeAt.set(-1);
      if (onTouchActive) scheduleOnRN(onTouchActive, false);
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

  const tap = Gesture.Tap().onEnd(() => {
    if (onPress) scheduleOnRN(onPress);
  });

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  // No Skia layers here (group opacity, blur): under Graphite the off-screen render pass they need
  // crashes the Adreno Vulkan driver, so the fade is a native opacity and glows are plain strokes.
  return (
    <GestureDetector gesture={horizon ? Gesture.Exclusive(pan, tap) : Gesture.Simultaneous(pinch, pan)}>
      <View style={{ width, height }}>
        {textures && dayImage && nightImage ? (
          <Animated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
          <Canvas style={StyleSheet.absoluteFill}>
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
                <ImageShader image={imagery.route?.day ?? NO_CLOUDS} fit="fill" x={0} y={0} width={routeSize[0]} height={routeSize[1]} sampling={SMOOTH} />
                <ImageShader image={imagery.route?.night ?? NO_CLOUDS} fit="fill" x={0} y={0} width={routeSize[0]} height={routeSize[1]} sampling={SMOOTH} />
                <ImageShader image={imagery.focus?.day ?? NO_CLOUDS} fit="fill" x={0} y={0} width={focusSize[0]} height={focusSize[1]} sampling={SMOOTH} />
                <ImageShader image={imagery.focus?.night ?? NO_CLOUDS} fit="fill" x={0} y={0} width={focusSize[0]} height={focusSize[1]} sampling={SMOOTH} />
                <ImageShader image={textures.sky} fit="fill" x={0} y={0} width={SKY_W} height={SKY_H} tx="repeat" ty="clamp" sampling={SMOOTH} />
              </Shader>
            </Fill>
            <Path path={homeArc} style="stroke" strokeWidth={1.4} color={isDark ? "#EDEFF5" : "#0E1018"} opacity={0.55} strokeCap="round">
              <DashPathEffect intervals={[3, 5]} />
            </Path>
            <Path path={brightLegs} style="stroke" strokeWidth={4} color="#000000" opacity={0.22} strokeCap="round" />
            <Path path={brightLegs} style="stroke" strokeWidth={2.2} color="#FFFFFF" strokeCap="round">
              <DashPathEffect intervals={DASH} />
            </Path>
            <Path path={faintLegs} style="stroke" strokeWidth={4} color="#000000" opacity={0.16} strokeCap="round" />
            <Path path={faintLegs} style="stroke" strokeWidth={2} color="#FFFFFF" opacity={0.7} strokeCap="round">
              <DashPathEffect intervals={DASH} />
            </Path>
            <Path path={nextPath} style="stroke" strokeWidth={4} color="#000000" opacity={0.22} strokeCap="round" />
            <Path path={nextPath} style="stroke" strokeWidth={2.2} color="#FFFFFF" strokeCap="round">
              <DashPathEffect intervals={DASH} phase={march} />
            </Path>
            {origin ? (
              <GlobePin stop={origin} focused={false} rotLng={rotLng} rotLat={rotLat} cx={cx} cy={cy} radius={radius} accent={isDark ? "#EDEFF5" : "#0E1018"} pulse={pulse} quiet />
            ) : null}
            {plannedPins.map((pin, i) => (
              <PlannedPin key={`planned-${i}`} stop={pin} rotLng={rotLng} rotLat={rotLat} cx={cx} cy={cy} radius={radius} color={isDark ? "#EDEFF5" : "#0E1018"} />
            ))}
            {contacts.map((contact, i) => (
              <GlobePin key={`contact-${i}`} stop={contact} focused={false} rotLng={rotLng} rotLat={rotLat} cx={cx} cy={cy} radius={radius} accent={contactColor} pulse={pulse} quiet />
            ))}
            {pins.map(({ stop, focused, visited }, i) => (
              <GlobePin
                key={`${stop.name}-${i}`}
                index={i}
                layout={stopLayout}
                stop={stop}
                focused={focused}
                visited={visited}
                rotLng={rotLng}
                rotLat={rotLat}
                cx={cx}
                cy={cy}
                radius={radius}
                accent={accent}
                pulse={pulse}
              />
            ))}
          </Canvas>
          </Animated.View>
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
        {labelStops && !horizon && dayImage && nightImage
          ? stops.map((stop, i) => (
              <StopLabel
                key={`label-${stop.name}-${i}`}
                index={i}
                stop={stop}
                focused={i === focusIndex}
                visited={pins[i]?.visited ?? false}
                layout={stopLayout}
                onWidth={onLabelWidth}
                rotLng={rotLng}
                rotLat={rotLat}
                cx={cx}
                cy={cy}
                radius={radius}
                fade={fade}
              />
            ))
          : null}
      </View>
    </GestureDetector>
  );
}

function GlobePin({
  index = 0,
  layout,
  stop,
  focused,
  visited = false,
  rotLng,
  rotLat,
  cx,
  cy,
  radius,
  accent,
  pulse,
  quiet = false,
}: {
  index?: number;
  /** Trip stops only: whether this pin survived the overlap check. */
  layout?: ReturnType<typeof useDerivedValue<StopLayout>>;
  quiet?: boolean;
  stop: GlobeStop;
  focused: boolean;
  visited?: boolean;
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
  const visible = useDerivedValue(() => (point.get().z > 0 ? (layout ? (layout.get().pinOn[index] ?? 1) : 1) * (visited ? 0.6 : 1) : 0));
  const lead = focused && !quiet;
  // The focused stop sends out a fading white ring.
  const ringR = useDerivedValue(() => 8 + pulse.get() * 16);
  const ringOpacity = useDerivedValue(() => (lead ? visible.get() * (1 - pulse.get()) * 0.7 : 0));

  // Waypoints: a soft dark rim, a white disc and a coloured centre. Per-circle opacity, not a Group
  // opacity, which would need an off-screen layer.
  return (
    <>
      <Circle cx={x} cy={y} r={ringR} color="#FFFFFF" style="stroke" strokeWidth={1.5} opacity={ringOpacity} />
      <Circle cx={x} cy={y} r={lead ? 9.5 : 5} color="rgba(0,0,0,0.4)" opacity={visible} />
      <Circle cx={x} cy={y} r={lead ? 8 : 4} color="#FFFFFF" opacity={visible} />
      <Circle cx={x} cy={y} r={lead ? 5 : 1.8} color={lead || quiet ? accent : "#3B3F52"} opacity={visible} />
    </>
  );
}

function PlannedPin({
  stop,
  rotLng,
  rotLat,
  cx,
  cy,
  radius,
  color,
}: {
  stop: GlobeStop;
  rotLng: ReturnType<typeof useSharedValue<number>>;
  rotLat: ReturnType<typeof useSharedValue<number>>;
  cx: number;
  cy: number;
  radius: ReturnType<typeof useDerivedValue<number>>;
  color: string;
}) {
  const point = useDerivedValue(() => project(stop.latitude * DEG, stop.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, radius.get()));
  const x = useDerivedValue(() => point.get().x);
  const y = useDerivedValue(() => point.get().y);
  const visible = useDerivedValue(() => (point.get().z > 0 ? 0.85 : 0));
  return (
    <Circle cx={x} cy={y} r={6} color={color} style="stroke" strokeWidth={1.5} opacity={visible}>
      <DashPathEffect intervals={[2.5, 2.5]} />
    </Circle>
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
  const { f } = useAura();
  const { formatTemperature } = useLocalization();
  // Sits up and to the right of the pin; fades out as the stop turns toward the limb.
  const style = useAnimatedStyle(() => {
    const point = project(stop.latitude * DEG, stop.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, radius.get());
    return {
      opacity: Math.min(1, Math.max(0, (point.z - 0.15) / 0.2)) * (fade.get() - 0.4) / 0.6,
      transform: [{ translateX: point.x + 9 }, { translateY: point.y - 30 }],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.badge, style]}>
      <Text style={styles.badgeEmoji}>{weather.emoji}</Text>
      <Text style={[styles.badgeText, { fontFamily: f.semibold }]}>{formatTemperature(weather.temperature)}</Text>
    </Animated.View>
  );
}

function labelGap(focused: boolean) {
  "worklet";
  return focused ? 13 : 9;
}

function labelHeight(focused: boolean) {
  "worklet";
  return focused ? 22 : 18;
}

/** A stop's city name in a small dark pill under its pin, so it reads over cloud and land. */
function StopLabel({
  index,
  stop,
  focused,
  visited,
  layout,
  onWidth,
  rotLng,
  rotLat,
  cx,
  cy,
  radius,
  fade,
}: {
  index: number;
  stop: GlobeStop;
  focused: boolean;
  visited: boolean;
  layout: ReturnType<typeof useDerivedValue<StopLayout>>;
  onWidth: (index: number, width: number) => void;
  rotLng: ReturnType<typeof useSharedValue<number>>;
  rotLat: ReturnType<typeof useSharedValue<number>>;
  cx: number;
  cy: number;
  radius: ReturnType<typeof useDerivedValue<number>>;
  fade: ReturnType<typeof useDerivedValue<number>>;
}) {
  const { f } = useAura();
  const style = useAnimatedStyle(() => {
    const point = project(stop.latitude * DEG, stop.longitude * DEG, rotLng.get(), rotLat.get(), cx, cy, radius.get());
    const limb = Math.min(1, Math.max(0, (point.z - 0.15) / 0.2));
    const [shown, ox, oy] = layout.get().labels[index] ?? [0, 0, 0];
    return {
      opacity: shown * limb * ((fade.get() - 0.4) / 0.6) * (visited ? 0.7 : 1),
      transform: [{ translateX: point.x + ox }, { translateY: point.y + oy }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(event) => onWidth(index, event.nativeEvent.layout.width)}
      style={[styles.labelWrap, styles.label, focused && styles.labelFocused, style]}
    >
      <Text numberOfLines={1} style={[styles.labelText, focused && styles.labelTextFocused, { fontFamily: focused ? f.semibold : f.medium }]}>
        {stop.name.split(",")[0]}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  labelWrap: { position: "absolute", left: 0, top: 0 },
  label: {
    maxWidth: LABEL_WIDTH,
    height: 18,
    justifyContent: "center",
    paddingHorizontal: 7,
    borderRadius: 9,
    backgroundColor: "rgba(10,12,20,0.6)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  labelFocused: { height: 22, paddingHorizontal: 9, borderRadius: 11, backgroundColor: "rgba(10,12,20,0.75)", borderColor: "rgba(255,255,255,0.22)" },
  labelText: { color: "#DFE1EA", fontSize: 11 },
  labelTextFocused: { color: "#FFFFFF", fontSize: 12.5 },
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
    backgroundColor: "rgba(10,12,20,0.7)",
    borderColor: "rgba(255,255,255,0.18)",
  },
  badgeEmoji: { fontSize: 11 },
  badgeText: { color: "#FFFFFF", fontSize: 12 },
});
