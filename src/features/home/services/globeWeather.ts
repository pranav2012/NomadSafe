import { storage } from "@/stores/storage";
import { describeWeather } from "@/features/trips/services/weatherService";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// Global cloud-cover grid: cell centres every 15°, rows from 82.5°N to 82.5°S, columns from 180°W.
export const CLOUD_STEP = 15;
export const CLOUD_COLS = 360 / CLOUD_STEP;
export const CLOUD_ROWS = 165 / CLOUD_STEP + 1;
const CLOUD_TOP = 82.5;

const CLOUD_KEY = "globe-clouds:v2";
const CLOUD_FRESH_MS = 3 * 3_600_000;
const CLOUD_STALE_MS = 24 * 3_600_000;
const STOPS_FRESH_MS = 30 * 60_000;

export interface StopWeather {
  temperature: number;
  emoji: string;
}

export interface CloudGrid {
  /** 0..1 per cell, row-major. */
  cover: number[];
  /** Cells currently reporting a thunderstorm (WMO 95–99). */
  storm: boolean[];
}

interface CachedClouds extends CloudGrid {
  fetchedAt: number;
}

let cloudsInflight: Promise<CloudGrid | null> | null = null;
const stopsCache = new Map<string, { fetchedAt: number; data: (StopWeather | null)[] }>();

function gridPoints() {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (let row = 0; row < CLOUD_ROWS; row += 1) {
    for (let col = 0; col < CLOUD_COLS; col += 1) {
      latitudes.push(CLOUD_TOP - row * CLOUD_STEP);
      longitudes.push(-180 + col * CLOUD_STEP);
    }
  }
  return { latitudes, longitudes };
}

async function fetchCurrent(latitudes: number[], longitudes: number[], fields: string) {
  const params = new URLSearchParams({ latitude: latitudes.join(","), longitude: longitudes.join(","), current: fields });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(`${FORECAST_URL}?${params.toString()}`, { signal: controller.signal }).finally(() => clearTimeout(timer));
  if (!response.ok) return null;
  const json = (await response.json()) as unknown;
  // A single location comes back as an object, several as an array.
  const list = (Array.isArray(json) ? json : [json]) as { current?: Record<string, number | null> }[];
  return list.length === latitudes.length ? list.map((item) => item.current ?? null) : null;
}

function readClouds(): CachedClouds | null {
  try {
    const raw = storage.getString(CLOUD_KEY);
    const cached = raw ? (JSON.parse(raw) as CachedClouds) : null;
    return cached && cached.cover.length === CLOUD_ROWS * CLOUD_COLS && cached.storm?.length === cached.cover.length ? cached : null;
  } catch {
    return null;
  }
}

/** Current cloud cover and thunderstorms on the global grid. Cached 3h; falls back to a day-old cache. */
export async function getGlobalClouds(): Promise<CloudGrid | null> {
  const cached = readClouds();
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age < CLOUD_FRESH_MS) return cached;

  cloudsInflight ??= (async () => {
    try {
      const { latitudes, longitudes } = gridPoints();
      const current = await fetchCurrent(latitudes, longitudes, "cloud_cover,weather_code");
      if (!current) return null;
      const grid: CloudGrid = {
        cover: current.map((c) => Math.min(1, Math.max(0, (c?.cloud_cover ?? 0) / 100))),
        storm: current.map((c) => (c?.weather_code ?? 0) >= 95),
      };
      storage.set(CLOUD_KEY, JSON.stringify({ fetchedAt: Date.now(), ...grid } satisfies CachedClouds));
      return grid;
    } catch {
      return null;
    } finally {
      cloudsInflight = null;
    }
  })();
  const fresh = await cloudsInflight;
  return fresh ?? (cached && age < CLOUD_STALE_MS ? cached : null);
}

/** Current temperature (°C) and condition emoji at each stop; entries are null where data is missing. */
export async function getStopsWeather(stops: { latitude: number; longitude: number }[]): Promise<(StopWeather | null)[] | null> {
  if (!stops.length) return [];
  const key = stops.map((s) => `${s.latitude.toFixed(2)},${s.longitude.toFixed(2)}`).join("|");
  const hit = stopsCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < STOPS_FRESH_MS) return hit.data;

  try {
    const current = await fetchCurrent(
      stops.map((s) => s.latitude),
      stops.map((s) => s.longitude),
      "temperature_2m,weather_code,is_day",
    );
    if (!current) return hit?.data ?? null;
    const data = current.map((c) => {
      if (typeof c?.temperature_2m !== "number" || typeof c.weather_code !== "number") return null;
      const night = c.is_day === 0;
      const emoji = night && c.weather_code === 0 ? "🌙" : night && c.weather_code <= 2 ? "☁️" : describeWeather(c.weather_code).emoji;
      return { temperature: Math.round(c.temperature_2m), emoji };
    });
    stopsCache.set(key, { fetchedAt: Date.now(), data });
    return data;
  } catch {
    return hit?.data ?? null;
  }
}
