import * as Location from "expo-location";

/** Fix quality: GPS-level accuracy costs the most battery. */
export type LocationAccuracy = "low" | "balanced" | "high" | "navigation";

export interface Position {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres, when known. */
  accuracy: number | null;
  /** Metres per second, when the OS knows it. */
  speed: number | null;
  timestamp: number;
}

export const ACCURACY: Record<LocationAccuracy, Location.Accuracy> = {
  low: Location.Accuracy.Low,
  balanced: Location.Accuracy.Balanced,
  high: Location.Accuracy.High,
  navigation: Location.Accuracy.BestForNavigation,
};

const RANK: Record<LocationAccuracy, number> = { low: 0, balanced: 1, high: 2, navigation: 3 };
// Fixes this close are good enough for a request of that accuracy.
const REQUIRED_METRES: Record<LocationAccuracy, number> = { low: 3000, balanced: 200, high: 50, navigation: 20 };

export function toPosition(location: Location.LocationObject): Position {
  const speed = location.coords.speed;
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null,
    // iOS reports -1 when the speed is unknown.
    speed: speed != null && speed >= 0 ? speed : null,
    timestamp: location.timestamp,
  };
}

let recent: { position: Position; accuracy: LocationAccuracy } | null = null;
let pending: { promise: Promise<Position>; accuracy: LocationAccuracy } | null = null;

/** A fresh fix. Throws when location services are off or permission is missing. */
export async function getCurrentPosition(accuracy?: LocationAccuracy): Promise<Position> {
  const position = toPosition(await Location.getCurrentPositionAsync(accuracy ? { accuracy: ACCURACY[accuracy] } : {}));
  if (accuracy && (!recent || recent.position.timestamp <= position.timestamp)) recent = { position, accuracy };
  return position;
}

/** The OS's cached fix (optionally no older than `maxAge` ms), or null. */
export async function getLastKnownPosition(options?: { maxAge?: number; requiredAccuracy?: number }): Promise<Position | null> {
  const location = await Location.getLastKnownPositionAsync(options);
  return location ? toPosition(location) : null;
}

/**
 * A position no older than `maxAgeMs` (default 2 min): the OS's cached fix or one this session
 * already took when good enough, else a fresh fix shared with any request already in flight, so
 * screens opening together don't each wake the GPS. Throws like getCurrentPosition.
 */
export async function getRecentPosition(accuracy: LocationAccuracy = "balanced", maxAgeMs = 2 * 60_000): Promise<Position> {
  const now = Date.now();
  if (recent && now - recent.position.timestamp <= maxAgeMs && RANK[recent.accuracy] >= RANK[accuracy]) return recent.position;
  const cached = await getLastKnownPosition({ maxAge: maxAgeMs, requiredAccuracy: REQUIRED_METRES[accuracy] }).catch(() => null);
  if (cached) return cached;
  if (pending && RANK[pending.accuracy] >= RANK[accuracy]) return pending.promise;
  const promise = getCurrentPosition(accuracy).finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { promise, accuracy };
  return promise;
}
