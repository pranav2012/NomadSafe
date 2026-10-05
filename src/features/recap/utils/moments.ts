import { addDays, fromDateKey } from "@/features/trips/utils/dates";
import { distanceKm, type MapPoint } from "@/features/trips/utils/mapFraming";

/** The trip's days in local time: from the first day's midnight to the midnight after the last. */
export function walkingWindow(trip: { startDate: string; endDate: string }): { start: Date; end: Date } {
  return { start: fromDateKey(trip.startDate), end: addDays(fromDateKey(trip.endDate), 1) };
}

/** Health apps can sync a day or two late, so totals read before then are read again. */
export function walkingStale(readAt: string | undefined, endDate: string): boolean {
  return !readAt || new Date(readAt) < addDays(fromDateKey(endDate), 3);
}

type Exif = Record<string, unknown> | null | undefined;

const nested = (exif: Exif, group: string): Record<string, unknown> => {
  const value = exif?.[group];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

/** "2026:10:18 14:22:05" (EXIF DateTimeOriginal, flat on Android, under {Exif} on iOS) → "2026-10-18T14:22:05". */
export function parseExifDate(exif: Exif): string | null {
  const raw = exif?.DateTimeOriginal ?? nested(exif, "{Exif}").DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== "string") return null;
  const match = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null;
}

/** A coordinate as a number, or as an EXIF rational "12/1,58/1,2312/100" (degrees, minutes, seconds). */
function coordinate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  if (!value.includes("/")) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  const parts = value.split(",").map((part) => {
    const [num, den] = part.split("/").map(Number);
    return den ? num / den : num;
  });
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return (parts[0] ?? 0) + (parts[1] ?? 0) / 60 + (parts[2] ?? 0) / 3600;
}

/** Where a photo was taken, from GPS EXIF ({GPS} on iOS, GPSLatitude… on Android); null when absent. */
export function parseExifGps(exif: Exif): MapPoint | null {
  const gps = nested(exif, "{GPS}");
  const lat = coordinate(gps.Latitude ?? exif?.GPSLatitude);
  const lon = coordinate(gps.Longitude ?? exif?.GPSLongitude);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
  const latRef = gps.LatitudeRef ?? exif?.GPSLatitudeRef;
  const lonRef = gps.LongitudeRef ?? exif?.GPSLongitudeRef;
  return { latitude: latRef === "S" ? -Math.abs(lat) : lat, longitude: lonRef === "W" ? -Math.abs(lon) : lon };
}

/** The stop a photo was taken at: the nearest one within `maxKm`, else null. */
export function nearestStop(point: MapPoint | null, stops: MapPoint[], maxKm = 60): number | null {
  if (!point) return null;
  let best: number | null = null;
  let bestKm = maxKm;
  stops.forEach((stop, i) => {
    const km = distanceKm(point, stop);
    if (km <= bestKm) {
      bestKm = km;
      best = i;
    }
  });
  return best;
}
