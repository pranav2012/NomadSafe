import * as Location from "expo-location";

/** Fix quality: GPS-level accuracy costs the most battery. */
export type LocationAccuracy = "low" | "balanced" | "high" | "navigation";

export interface Position {
  latitude: number;
  longitude: number;
  /** Radius of uncertainty in metres, when known. */
  accuracy: number | null;
  timestamp: number;
}

export const ACCURACY: Record<LocationAccuracy, Location.Accuracy> = {
  low: Location.Accuracy.Low,
  balanced: Location.Accuracy.Balanced,
  high: Location.Accuracy.High,
  navigation: Location.Accuracy.BestForNavigation,
};

export function toPosition(location: Location.LocationObject): Position {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null,
    timestamp: location.timestamp,
  };
}

/** A fresh fix. Throws when location services are off or permission is missing. */
export async function getCurrentPosition(accuracy?: LocationAccuracy): Promise<Position> {
  return toPosition(await Location.getCurrentPositionAsync(accuracy ? { accuracy: ACCURACY[accuracy] } : {}));
}

/** The OS's cached fix (optionally no older than `maxAge` ms), or null. */
export async function getLastKnownPosition(options?: { maxAge?: number }): Promise<Position | null> {
  const location = await Location.getLastKnownPositionAsync(options);
  return location ? toPosition(location) : null;
}
