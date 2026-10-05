import { USER_NEARBY_KM, distanceKm } from "@/features/trips/utils/mapFraming";
import type { TripStatus } from "@/features/trips/utils/dates";

interface Point {
  latitude: number;
  longitude: number;
}

// NASA GIBS EPSG:4326 "500m" set: 512px tiles, level n spans 288 / 2^n degrees. Levels under 3 are no
// sharper than the bundled textures; 3x3 tiles (1536px) keeps each decoded texture under ~10 MB.
export const TILE_PX = 512;
const MAX_LEVEL = 7;
const MIN_LEVEL = 3;
const MAX_TILES = 3;

/** Equirectangular rectangle in degrees. `west + width` may run past 180 when the box wraps the antimeridian. */
export interface DetailBox {
  west: number;
  south: number;
  width: number;
  height: number;
}

export interface TileBox {
  level: number;
  col: number;
  row: number;
  cols: number;
  rows: number;
}

export function tileSpan(level: number) {
  return 288 / 2 ** level;
}

export function tileColumns(level: number) {
  return Math.round(360 / tileSpan(level));
}

export function tileBoxKey(t: TileBox) {
  return `${t.level}_${t.col}_${t.row}_${t.cols}_${t.rows}`;
}

export function boxDegrees(t: TileBox): DetailBox {
  const span = tileSpan(t.level);
  return { west: -180 + t.col * span, south: 90 - (t.row + t.rows) * span, width: t.cols * span, height: t.rows * span };
}

/** Sharpest tile-aligned box covering the points plus `marginDeg`, wrapping the antimeridian; null if too coarse to help. */
export function tileBoxFor(points: Point[], marginDeg: number, maxTiles = MAX_TILES): TileBox | null {
  if (!points.length) return null;
  const ref = points[0].longitude;
  const rel = points.map((p) => ((((p.longitude - ref) % 360) + 540) % 360) - 180);
  const west = ref + Math.min(...rel) - marginDeg;
  const east = ref + Math.max(...rel) + marginDeg;
  const north = Math.min(90, Math.max(...points.map((p) => p.latitude)) + marginDeg);
  const south = Math.max(-90, Math.min(...points.map((p) => p.latitude)) - marginDeg);
  if (east - west >= 360) return null;

  for (let level = MAX_LEVEL; level >= MIN_LEVEL; level -= 1) {
    const span = tileSpan(level);
    const c0 = Math.floor((west + 180) / span);
    const c1 = Math.ceil((east + 180) / span);
    const r0 = Math.floor((90 - north) / span);
    const r1 = Math.ceil((90 - south) / span);
    if (c1 - c0 <= maxTiles && r1 - r0 <= maxTiles) {
      const total = tileColumns(level);
      return { level, col: ((c0 % total) + total) % total, row: r0, cols: c1 - c0, rows: r1 - r0 };
    }
  }
  return null;
}

/** Today's stop: the one the user is near during the trip, else the days split evenly across stops; first before, last after. */
export function todayStopIndex(stops: Point[], phase: TripStatus, day: number, totalDays: number, here?: Point | null) {
  if (stops.length <= 1) return 0;
  if (phase === "upcoming") return 0;
  if (phase === "complete") return stops.length - 1;
  if (here) {
    const nearest = stops
      .map((stop, index) => ({ index, km: distanceKm(stop, here) }))
      .sort((a, b) => a.km - b.km)[0];
    if (nearest.km <= USER_NEARBY_KM) return nearest.index;
  }
  const dayIndex = Math.max(0, Math.min(totalDays - 1, day - 1));
  return Math.min(stops.length - 1, Math.floor((dayIndex * stops.length) / Math.max(1, totalDays)));
}
