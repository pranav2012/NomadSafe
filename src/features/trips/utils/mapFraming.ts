export interface MapPoint {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends MapPoint {
  latitudeDelta: number;
  longitudeDelta: number;
}

export const USER_NEARBY_KM = 150;
export const CITY_DELTA = 0.3;
const WORLD_REGION: MapRegion = { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 120 };

/** Great-circle distance in km (haversine). */
export function distanceKm(a: MapPoint, b: MapPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Destinations to frame, plus the user only when within `USER_NEARBY_KM` of one. */
export function tripFramePoints(destinations: MapPoint[], user: MapPoint | null): MapPoint[] {
  if (destinations.length === 0) return user ? [user] : [];
  if (user && destinations.some((destination) => distanceKm(user, destination) <= USER_NEARBY_KM)) {
    return [user, ...destinations];
  }
  return destinations;
}

/** Region covering `points` with ~40% margin; never tighter than city level. */
export function regionForPoints(points: MapPoint[], minDelta = CITY_DELTA): MapRegion {
  if (points.length === 0) return WORLD_REGION;
  const lats = points.map((point) => point.latitude);
  const lons = points.map((point) => point.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.min(170, Math.max(minDelta, (maxLat - minLat) * 1.4)),
    longitudeDelta: Math.min(360, Math.max(minDelta, (maxLon - minLon) * 1.4)),
  };
}

/** True when the points span less than a city, so fitting would over-zoom. */
export function isCompactFrame(points: MapPoint[], minDelta = CITY_DELTA): boolean {
  const region = regionForPoints(points, 0);
  return region.latitudeDelta < minDelta && region.longitudeDelta < minDelta;
}
