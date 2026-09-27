import * as Location from "expo-location";
import { storage } from "@/stores/storage";

export interface ResolvedCountry {
  code: string;
  name?: string;
}

interface CachedCountry extends ResolvedCountry {
  latitude: number;
  longitude: number;
  at: number;
}

const CACHE_KEY = "safety.country-cache";
const MAX_ENTRIES = 12;
const MATCH_RADIUS_KM = 150;

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function readCache(): CachedCountry[] {
  const raw = storage.getString(CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedCountry[]) : [];
  } catch {
    return [];
  }
}

function remember(entry: CachedCountry) {
  const rest = readCache().filter(
    (c) => c.code !== entry.code || distanceKm(c, entry) > MATCH_RADIUS_KM / 3,
  );
  storage.set(CACHE_KEY, JSON.stringify([entry, ...rest].slice(0, MAX_ENTRIES)));
}

/**
 * Resolves the ISO country for coordinates via the OS geocoder. Offline it
 * falls back to the nearest previously resolved country within 150 km.
 */
export async function resolveCountry(
  coords: { latitude: number; longitude: number },
): Promise<ResolvedCountry | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync(coords);
    if (place?.isoCountryCode) {
      const resolved = { code: place.isoCountryCode.toUpperCase(), name: place.country ?? undefined };
      remember({ ...resolved, latitude: coords.latitude, longitude: coords.longitude, at: Date.now() });
      return resolved;
    }
  } catch {
    // Geocoder needs a network on most devices; use the cache below.
  }
  let best: CachedCountry | null = null;
  let bestKm = Infinity;
  for (const entry of readCache()) {
    const km = distanceKm(entry, coords);
    if (km < bestKm) {
      best = entry;
      bestKm = km;
    }
  }
  return best && bestKm <= MATCH_RADIUS_KM ? { code: best.code, name: best.name } : null;
}
