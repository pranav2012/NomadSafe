import type { TransitMode } from "@/features/itinerary/constants/eventTypes";
import type { MapPoint } from "@/features/trips/utils/mapFraming";
import type { GeoBox } from "./countryShapes";

export interface Point {
  x: number;
  y: number;
}

export interface MapFrame {
  width: number;
  height: number;
  scale: number;
  /** The geographic area on screen, for picking which countries to draw. */
  box: GeoBox;
  project: (longitude: number, latitude: number) => Point;
}

const MIN_SPAN = 3.5;
const MAX_REGION_SPAN = 24;

/**
 * Fits the stops into a width × height box (equirectangular, squashed by the cosine of the mean
 * latitude so shapes look right). A single stop shows `region` (its country) when given, capped so a
 * big country doesn't shrink the city to a dot.
 */
export function frameRoute(stops: MapPoint[], width: number, height: number, padding: number, region?: GeoBox | null): MapFrame {
  const anchor = stops[0] ?? { latitude: 20, longitude: 0 };
  const unwrap = (lon: number) => anchor.longitude + ((((lon - anchor.longitude) % 360) + 540) % 360) - 180;
  const meanLat = stops.length > 0 ? stops.reduce((sum, stop) => sum + stop.latitude, 0) / stops.length : anchor.latitude;
  const k = Math.cos((Math.max(-60, Math.min(60, meanLat)) * Math.PI) / 180);

  let xs = stops.map((stop) => unwrap(stop.longitude) * k);
  let ys = stops.map((stop) => -stop.latitude);
  if (stops.length === 1 && region) {
    const spanLon = Math.min(MAX_REGION_SPAN, region.east - region.west);
    const spanLat = Math.min(MAX_REGION_SPAN, region.north - region.south);
    const midLon = Math.max(region.west + spanLon / 2, Math.min(region.east - spanLon / 2, anchor.longitude));
    const midLat = Math.max(region.south + spanLat / 2, Math.min(region.north - spanLat / 2, anchor.latitude));
    xs = [(midLon - spanLon / 2) * k, (midLon + spanLon / 2) * k];
    ys = [-(midLat + spanLat / 2), -(midLat - spanLat / 2)];
  }
  if (xs.length === 0) {
    xs = [anchor.longitude * k];
    ys = [-anchor.latitude];
  }

  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(MIN_SPAN * k, Math.max(...xs) - Math.min(...xs));
  const spanY = Math.max(MIN_SPAN, Math.max(...ys) - Math.min(...ys));
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);

  const halfLon = width / 2 / scale / k;
  const halfLat = height / 2 / scale;
  return {
    width,
    height,
    scale,
    box: { west: cx / k - halfLon, east: cx / k + halfLon, south: -cy - halfLat, north: -cy + halfLat },
    project: (longitude, latitude) => ({
      x: (unwrap(longitude) * k - cx) * scale + width / 2,
      y: (-latitude - cy) * scale + height / 2,
    }),
  };
}

/** Control point for a leg's curve: flights bow out like a flight path, ground legs barely bend. */
export function legControl(a: Point, b: Point, mode: TransitMode | null): Point {
  const bend = mode === "flight" ? 0.32 : 0.12;
  return { x: (a.x + b.x) / 2 + (b.y - a.y) * bend, y: (a.y + b.y) / 2 - (b.x - a.x) * bend };
}

/** A point along the quadratic curve a → control → b at t (0..1). */
export function curvePoint(a: Point, control: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
}

export interface LabelRequest {
  at: Point;
  width: number;
  height: number;
  /** Lower goes first; the first and last stops are always tried before the rest. */
  priority: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Places each label right, left, above or below its dot, skipping a label rather than letting it
 * overlap another label, another dot or the edge. Index-aligned with `requests`; null when skipped.
 */
export function placeLabels(requests: LabelRequest[], bounds: { width: number; height: number }, dotRadius: number, gap = 10): (Rect | null)[] {
  const dots: Rect[] = requests.map(({ at }) => ({ x: at.x - dotRadius, y: at.y - dotRadius, width: dotRadius * 2, height: dotRadius * 2 }));
  const placed: (Rect | null)[] = requests.map(() => null);
  const taken: Rect[] = [];
  const order = requests.map((_, i) => i).sort((a, b) => requests[a].priority - requests[b].priority);
  for (const i of order) {
    const { at, width, height } = requests[i];
    const r = dotRadius + gap;
    const candidates: Rect[] = [
      { x: at.x + r, y: at.y - height / 2, width, height },
      { x: at.x - r - width, y: at.y - height / 2, width, height },
      { x: at.x - width / 2, y: at.y - r - height, width, height },
      { x: at.x - width / 2, y: at.y + r, width, height },
    ];
    const fit = candidates.find(
      (rect) =>
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= bounds.width &&
        rect.y + rect.height <= bounds.height &&
        !taken.some((other) => overlaps(rect, other)) &&
        !dots.some((dot, j) => j !== i && overlaps(rect, dot)),
    );
    if (fit) {
      placed[i] = fit;
      taken.push(fit);
    }
  }
  return placed;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Pan and zoom (screen = point × zoom + offset) that fit `points` inside `region`. Close points are
 * treated as at least `minSize` apart, so a single stop isn't zoomed in to a blur.
 */
export function cameraFor(points: Point[], region: Rect, opts: { padding: number; minSize: number; maxZoom: number }): Camera {
  if (points.length === 0) return { x: 0, y: 0, zoom: 1 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const width = Math.max(opts.minSize, Math.max(...xs) - Math.min(...xs));
  const height = Math.max(opts.minSize, Math.max(...ys) - Math.min(...ys));
  const zoom = Math.min(opts.maxZoom, (region.width - 2 * opts.padding) / width, (region.height - 2 * opts.padding) / height);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { x: region.x + region.width / 2 - cx * zoom, y: region.y + region.height / 2 - cy * zoom, zoom };
}
