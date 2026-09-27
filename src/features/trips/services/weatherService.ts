import { storage } from "@/stores/storage";
import type { LatLng } from "@/features/trips/store/tripsStore";

export interface DailyForecast {
  date: string; // YYYY-MM-DD (local to the destination)
  weatherCode: number;
  tempMax: number;
  tempMin: number | null;
  feelsLike: number | null; // apparent temperature (max), rounded
  uvIndex: number | null; // UV index (max), rounded
  precipProbability: number | null;
}

export interface WeatherCondition {
  emoji: string;
  labelKey: string; // i18n key under `trip.weatherConditions`
}

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

// Open-Meteo forecast covers a limited window: recent past through ~16 days ahead.
const MAX_FORECAST_DAYS_AHEAD = 15;

/** Maps WMO weather interpretation codes to an emoji + i18n condition label. */
export function describeWeather(code: number): WeatherCondition {
  if (code === 0) return { emoji: "☀️", labelKey: "clear" };
  if (code <= 2) return { emoji: "⛅", labelKey: "partlyCloudy" };
  if (code === 3) return { emoji: "☁️", labelKey: "overcast" };
  if (code <= 48) return { emoji: "🌫️", labelKey: "fog" };
  if (code <= 57) return { emoji: "🌦️", labelKey: "drizzle" };
  if (code <= 67) return { emoji: "🌧️", labelKey: "rain" };
  if (code <= 77) return { emoji: "🌨️", labelKey: "snow" };
  if (code <= 82) return { emoji: "🌧️", labelKey: "showers" };
  if (code <= 86) return { emoji: "🌨️", labelKey: "snowShowers" };
  return { emoji: "⛈️", labelKey: "thunderstorm" };
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Clamps a trip's date range to the window Open-Meteo can forecast (today through
 * ~16 days out). Returns null when no part of the trip falls inside that window,
 * so callers can show a "forecast available closer to your trip" note instead.
 */
export function clampToForecastWindow(
  startDate: string,
  endDate: string,
): { start: string; end: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + MAX_FORECAST_DAYS_AHEAD);

  const tripStart = fromDateKey(startDate);
  const tripEnd = fromDateKey(endDate);

  const start = tripStart < today ? today : tripStart;
  const end = tripEnd > horizon ? horizon : tripEnd;

  if (start > end) return null;
  return { start: toDateKey(start), end: toDateKey(end) };
}

interface CachedForecast {
  day: string; // YYYY-MM-DD the forecast was fetched on
  data: DailyForecast[];
}

// Persisted (MMKV) forecast cache, valid for the calendar day it was fetched.
// Survives app restarts but is refreshed once the date rolls over. An in-memory
// map dedupes concurrent in-flight requests within a session.
const inflight = new Map<string, Promise<DailyForecast[] | null>>();

const CACHE_PREFIX = "weather:";
const CACHE_VERSION_PREFIX = `${CACHE_PREFIX}v3:`;

function cacheKey(coords: LatLng, start: string, end: string) {
  return `${CACHE_VERSION_PREFIX}${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}|${start}|${end}`;
}

/** Drops forecast entries from older cache versions or previous days. */
function evictStaleCache(today: string) {
  try {
    for (const key of storage.getAllKeys()) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      if (!key.startsWith(CACHE_VERSION_PREFIX)) {
        storage.remove(key);
        continue;
      }
      const raw = storage.getString(key);
      const day = raw ? (JSON.parse(raw) as Partial<CachedForecast>).day : undefined;
      if (day !== today) storage.remove(key);
    }
  } catch {
    // Eviction is housekeeping; a failure must not block the forecast.
  }
}

function readCache(key: string): DailyForecast[] | null {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as CachedForecast;
    return cached.day === toDateKey(new Date()) ? cached.data : null;
  } catch {
    return null;
  }
}

/**
 * Day-cached wrapper around {@link fetchDailyForecast}. Returns the persisted
 * forecast when it was fetched today; otherwise fetches once, caches it for the
 * rest of the day, and dedupes concurrent in-flight requests. Failed lookups are
 * not cached, so they can retry.
 */
export function getDailyForecast(
  coords: LatLng,
  start: string,
  end: string,
): Promise<DailyForecast[] | null> {
  const key = cacheKey(coords, start, end);

  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = fetchDailyForecast(coords, start, end)
    .then((result) => {
      if (result) {
        const today = toDateKey(new Date());
        evictStaleCache(today);
        storage.set(key, JSON.stringify({ day: today, data: result }));
      }
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

interface ForecastResponse {
  daily?: {
    time?: string[];
    weather_code?: (number | null)[];
    temperature_2m_max?: (number | null)[];
    temperature_2m_min?: (number | null)[];
    apparent_temperature_max?: (number | null)[];
    uv_index_max?: (number | null)[];
    precipitation_probability_max?: (number | null)[];
  };
}

/**
 * Fetches the daily forecast for a destination across the given date range.
 * Returns null on network failure, an empty range, or malformed data so the UI
 * can degrade gracefully.
 */
export async function fetchDailyForecast(
  coords: LatLng,
  start: string,
  end: string,
): Promise<DailyForecast[] | null> {
  try {
    const params = new URLSearchParams({
      latitude: `${coords.latitude}`,
      longitude: `${coords.longitude}`,
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,uv_index_max,precipitation_probability_max",
      timezone: "auto",
      start_date: start,
      end_date: end,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${FORECAST_URL}?${params.toString()}`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return null;

    const json = (await response.json()) as ForecastResponse;
    const daily = json.daily;
    if (!daily?.time?.length) return null;

    const round = (value: number | null | undefined) =>
      typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;

    // Days without a weather code or max temperature are dropped rather than
    // rendered as a fake "Clear 0°".
    const days: DailyForecast[] = [];
    daily.time.forEach((date, i) => {
      const weatherCode = daily.weather_code?.[i];
      const tempMax = round(daily.temperature_2m_max?.[i]);
      if (typeof weatherCode !== "number" || tempMax == null) return;
      days.push({
        date,
        weatherCode,
        tempMax,
        tempMin: round(daily.temperature_2m_min?.[i]),
        feelsLike: round(daily.apparent_temperature_max?.[i]),
        uvIndex: round(daily.uv_index_max?.[i]),
        precipProbability: daily.precipitation_probability_max?.[i] ?? null,
      });
    });
    return days.length ? days : null;
  } catch {
    return null;
  }
}
