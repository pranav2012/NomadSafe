import { COUNTRY_SHAPES, COUNTRY_SHAPES_IN_VIEW } from "../data/countryShapes";
import { boundaryView } from "./boundaries";

/** [longitude, latitude] */
export type LonLat = [number, number];

export interface GeoBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const decoded = new Map<string, LonLat[][]>();

/** Google polyline at 0.01°, stored as [lat, lng] deltas. */
export function decodePolyline(value: string): LonLat[] {
  const points: LonLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = value.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < value.length) {
    lat += next();
    lng += next();
    points.push([lng / 100, lat / 100]);
  }
  return points;
}

/** The outline row for a country in the current border view. */
function entryOf(code: string) {
  return (boundaryView() === "IN" ? COUNTRY_SHAPES_IN_VIEW[code] : undefined) ?? COUNTRY_SHAPES[code];
}

/** Outer rings of a country's outline; empty for an unknown code. */
export function countryRings(code: string): LonLat[][] {
  const id = `${boundaryView()}|${code}`;
  const cached = decoded.get(id);
  if (cached) return cached;
  const entry = entryOf(code);
  const rings = entry ? entry[1].split(";").map(decodePolyline) : [];
  decoded.set(id, rings);
  return rings;
}

export function countryBox(code: string): GeoBox | null {
  const entry = entryOf(code);
  if (!entry) return null;
  const [west, south, east, north] = entry[0];
  return { west, south, east, north };
}

/** Countries whose bounds overlap `box` (no antimeridian wrap: the recap map never spans it). */
export function countriesInBox(box: GeoBox): string[] {
  return Object.keys(COUNTRY_SHAPES).filter((code) => {
    const b = countryBox(code)!;
    return b.west <= box.east && b.east >= box.west && b.south <= box.north && b.north >= box.south;
  });
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

/** The country containing the point, or null at sea / on a coastline the simplified outline misses. */
export function countryAt(latitude: number, longitude: number): string | null {
  for (const code of Object.keys(COUNTRY_SHAPES)) {
    const b = countryBox(code)!;
    if (longitude < b.west || longitude > b.east || latitude < b.south || latitude > b.north) continue;
    if (countryRings(code).some((ring) => insideRing(longitude, latitude, ring))) return code;
  }
  return null;
}
