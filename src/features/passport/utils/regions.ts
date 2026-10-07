import { decodePolyline, type GeoBox, type LonLat } from "@/features/recap/utils/countryShapes";
import { boundaryView } from "@/features/recap/utils/boundaries";

type RegionData = typeof import("../data/regionShapes");
let regionData: RegionData | null = null;

// The state outlines (~800 KB of source) load on the first lookup rather than at app launch.
function shapes(): RegionData {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (regionData ??= require("../data/regionShapes") as RegionData);
}

export interface Region {
  key: string;
  name: string;
  box: GeoBox;
  /** Overseas parts (e.g. French Guiana) that the home map leaves out. */
  far: boolean;
}

const decoded = new Map<string, LonLat[][]>();
const listed = new Map<string, Region[]>();

/** A country's region rows in the current border view. */
function rowsOf(country: string) {
  const { REGION_SHAPES, REGION_SHAPES_IN_VIEW } = shapes();
  return (boundaryView() === "IN" ? REGION_SHAPES_IN_VIEW[country] : undefined) ?? REGION_SHAPES[country] ?? [];
}

/** A country's states or provinces; empty when the data has none. */
export function countryRegions(country: string): Region[] {
  const id = `${boundaryView()}|${country}`;
  const cached = listed.get(id);
  if (cached) return cached;
  const regions = rowsOf(country).map(([key, name, [west, south, east, north], far]) => ({
    key,
    name,
    box: { west, south, east, north },
    far: far === 1,
  }));
  listed.set(id, regions);
  return regions;
}

export function regionRings(country: string, key: string): LonLat[][] {
  const id = `${boundaryView()}|${country}|${key}`;
  const cached = decoded.get(id);
  if (cached) return cached;
  const row = rowsOf(country).find((entry) => entry[0] === key);
  const rings = row ? row[4].split(";").map(decodePolyline) : [];
  decoded.set(id, rings);
  return rings;
}

function insideRing(lon: number, lat: number, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The state a point is in, within `country`. A coastal city just outside the simplified outline
 * falls back to the region whose bounds centre is nearest.
 */
export function regionAt(country: string, latitude: number, longitude: number): Region | null {
  const regions = countryRegions(country);
  if (regions.length === 0) return null;
  const candidates = regions.filter(
    ({ box }) => longitude >= box.west && longitude <= box.east && latitude >= box.south && latitude <= box.north,
  );
  const hit = candidates.find((region) => regionRings(country, region.key).some((ring) => insideRing(longitude, latitude, ring)));
  if (hit) return hit;
  const pool = candidates.length > 0 ? candidates : regions;
  const distance = ({ box }: Region) => Math.hypot((box.west + box.east) / 2 - longitude, (box.south + box.north) / 2 - latitude);
  return pool.reduce((best, region) => (distance(region) < distance(best) ? region : best), pool[0]);
}

/** Bounds of the country's mainland regions, for framing the home map. */
export function mainlandBox(country: string): GeoBox | null {
  const regions = countryRegions(country).filter((region) => !region.far);
  if (regions.length === 0) return null;
  return {
    west: Math.min(...regions.map((r) => r.box.west)),
    south: Math.min(...regions.map((r) => r.box.south)),
    east: Math.max(...regions.map((r) => r.box.east)),
    north: Math.max(...regions.map((r) => r.box.north)),
  };
}
