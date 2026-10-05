import { storage } from "@/modules/storage";
import { describeWeather, getPlaceWeather, weatherNow } from "@/features/trips/services/weatherService";

// Global cloud-cover grid: cell centres every 15°, rows from 82.5°N to 82.5°S, columns from 180°W.
// Must match the grid convex/weather.ts refreshes.
export const CLOUD_STEP = 15;
export const CLOUD_COLS = 360 / CLOUD_STEP;
export const CLOUD_ROWS = 165 / CLOUD_STEP + 1;

const CLOUD_KEY = "globe-clouds:v2";
const CLOUD_STALE_MS = 24 * 3_600_000;

export interface StopWeather {
  temperature: number;
  emoji: string;
}

export interface CloudGrid {
  /** 0..1 per cell, row-major. */
  cover: number[];
  /** Cells currently reporting a thunderstorm. */
  storm: boolean[];
}

interface CachedClouds extends CloudGrid {
  fetchedAt: number;
}

export function isCloudGrid(grid: CloudGrid | null | undefined): grid is CloudGrid {
  return !!grid && grid.cover.length === CLOUD_ROWS * CLOUD_COLS && grid.storm?.length === grid.cover.length;
}

/** Last cloud grid seen on this phone, up to a day old, so the globe has clouds offline and on its first frame. */
export function readCachedClouds(): CloudGrid | null {
  try {
    const raw = storage.getString(CLOUD_KEY);
    const cached = raw ? (JSON.parse(raw) as CachedClouds) : null;
    return isCloudGrid(cached) && Date.now() - cached.fetchedAt < CLOUD_STALE_MS ? cached : null;
  } catch {
    return null;
  }
}

export function saveCachedClouds(grid: CloudGrid, fetchedAt: number) {
  storage.set(CLOUD_KEY, JSON.stringify({ fetchedAt, cover: grid.cover, storm: grid.storm } satisfies CachedClouds));
}

/** Current temperature (°C) and condition emoji at each stop, from each place's stored hourly outlook. */
export async function getStopsWeather(stops: { latitude: number; longitude: number }[]): Promise<(StopWeather | null)[] | null> {
  if (!stops.length) return [];
  const places = await Promise.all(stops.map(getPlaceWeather));
  if (places.every((place) => place === null)) return null;
  return places.map((place) => {
    const now = place ? weatherNow(place) : null;
    if (!now) return null;
    const emoji = !now.isDay && now.weatherCode === 0 ? "🌙" : !now.isDay && now.weatherCode <= 2 ? "☁️" : describeWeather(now.weatherCode).emoji;
    return { temperature: now.temperature, emoji };
  });
}
