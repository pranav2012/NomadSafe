const DEG = Math.PI / 180;

export interface City {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: "visited" | "today" | "next";
}

export const CITIES: City[] = [
  { id: "paris", name: "Paris", lat: 48.8566, lng: 2.3522, kind: "visited" },
  { id: "amsterdam", name: "Amsterdam", lat: 52.3676, lng: 4.9041, kind: "visited" },
  { id: "berlin", name: "Berlin", lat: 52.52, lng: 13.405, kind: "visited" },
  { id: "prague", name: "Prague", lat: 50.0755, lng: 14.4378, kind: "visited" },
  { id: "lisbon", name: "Lisbon", lat: 38.7223, lng: -9.1393, kind: "today" },
  { id: "porto", name: "Porto", lat: 41.1579, lng: -8.6291, kind: "next" },
];

export const LEGS: { from: string; to: string; today?: boolean }[] = [
  { from: "paris", to: "amsterdam" },
  { from: "amsterdam", to: "berlin" },
  { from: "berlin", to: "prague" },
  { from: "lisbon", to: "porto", today: true },
];


/** Where the disc sits in the overlay's viewBox units: centre and radius. */
export interface Frame {
  width: number;
  height: number;
  cx: number;
  cy: number;
  r: number;
}

type Vec3 = [number, number, number];
/** Row-major 3×3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function toVector(lat: number, lng: number): Vec3 {
  const la = lat * DEG;
  const lo = lng * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/** World → view rotation that brings (lat, lng) to the centre of the disc: Rx(lat) · Ry(−lng). */
export function viewMatrix(lat: number, lng: number): Mat3 {
  const a = lat * DEG;
  const b = lng * DEG;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return [cb, 0, -sb, -sa * sb, ca, -sa * cb, ca * sb, sa, ca * cb];
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Screen position in the overlay viewBox, and whether the point is in front of (or beside) the globe. */
export function project(m: Mat3, v: Vec3, f: Frame) {
  const [x, y, z] = apply(m, v);
  return { x: f.cx + x * f.r, y: f.cy - y * f.r, z, visible: z > 0 || x * x + y * y > 1 };
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return a;
  const s = Math.sin(omega);
  const ka = Math.sin((1 - t) * omega) / s;
  const kb = Math.sin(t * omega) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

/** A leg as a great circle lifted off the surface, split into the runs that are visible from the camera. */
export function arcPath(m: Mat3, from: City, to: City, f: Frame, steps = 40) {
  const a = toVector(from.lat, from.lng);
  const b = toVector(to.lat, to.lng);
  const angle = Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  let d = "";
  let pen = false;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lift = 1 + (0.18 * angle + 0.006) * Math.sin(Math.PI * t);
    const p = slerp(a, b, t);
    const point = project(m, [p[0] * lift, p[1] * lift, p[2] * lift], f);
    if (!point.visible) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Approximate subsolar point (same formula as the app's globe). */
export function sunVector(date: Date): Vec3 {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86_400_000;
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const longitude = -15 * (utcHours - 12);
  return toVector(declination, ((longitude + 540) % 360) - 180);
}

const SYNODIC_MONTH_DAYS = 29.530589;
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

export function moonIllumination(date: Date) {
  const age = ((((date.getTime() - KNOWN_NEW_MOON_MS) / 86_400_000) % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  return (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH_DAYS)) / 2;
}
