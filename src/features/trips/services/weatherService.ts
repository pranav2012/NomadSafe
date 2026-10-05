import { api, convex } from "@/modules/backend";
import { storage } from "@/modules/storage";
import type { LatLng } from "@/features/trips/store/tripsStore";

export interface DailyForecast {
  date: string; // YYYY-MM-DD (local to the destination)
  weatherCode: number;
  tempMax: number;
  tempMin: number | null;
  feelsLike: number | null; // apparent temperature (max), rounded
  uvIndex: number | null; // clear-sky UV index (max), rounded; only for the next ~2.5 days
  precipMm: number | null; // total rain/snow (mm)
}

export interface WeatherCondition {
  emoji: string;
  labelKey: string; // i18n key under `trip.weatherConditions`
}

// MET Norway forecasts about 9.5 days ahead; the last half day is too partial to show.
const MAX_FORECAST_DAYS_AHEAD = 8;

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
 * Clamps a trip's date range to the window MET Norway can forecast (today through
 * ~8 days out). Returns null when no part of the trip falls inside that window,
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

export interface HourWeather {
  t: number; // epoch ms the hour starts
  temperature: number;
  weatherCode: number;
  isDay: boolean;
}

export interface PlaceWeather {
  days: DailyForecast[];
  hours: HourWeather[];
}

// Each place is fetched at most every 6 hours per phone (kept low for the Convex free plan); the stored
// 24-hour outlook covers "now" in between.
const PLACE_FRESH_MS = 6 * 3_600_000;
const PLACE_KEEP_MS = 24 * 3_600_000;
const CACHE_PREFIX = "weather:";
const CACHE_VERSION_PREFIX = `${CACHE_PREFIX}v5:`;

interface CachedPlace {
  fetchedAt: number;
  data: PlaceWeather;
}

const inflight = new Map<string, Promise<PlaceWeather | null>>();

/** ~11 km is all the server needs: it caches and asks MET Norway per 0.1° cell. */
function roundedArgs(coords: LatLng) {
  const round = (deg: number) => Math.round(deg * 10) / 10;
  return { latitude: round(coords.latitude), longitude: round(coords.longitude) };
}

/** The shared server copy (a cached Convex query) if it's current, else a refresh from MET Norway. */
async function fetchPlaceWeather(coords: LatLng): Promise<PlaceWeather | null> {
  const args = roundedArgs(coords);
  try {
    const cached = await convex.query(api.weather.cell, args);
    if (cached && cached.expiresAt > Date.now()) return cached.summary;
    return (await convex.action(api.weather.refresh, { ...args, lastModified: cached?.lastModified })) ?? cached?.summary ?? null;
  } catch {
    return null;
  }
}

function cacheKey(coords: LatLng) {
  const { latitude, longitude } = roundedArgs(coords);
  return `${CACHE_VERSION_PREFIX}${latitude},${longitude}`;
}

function readCache(key: string): CachedPlace | null {
  try {
    const raw = storage.getString(key);
    return raw ? (JSON.parse(raw) as CachedPlace) : null;
  } catch {
    return null;
  }
}

/** Drops places from older cache versions or not fetched for a day. */
function evictStaleCache() {
  try {
    for (const key of storage.getAllKeys()) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      const cached = key.startsWith(CACHE_VERSION_PREFIX) ? readCache(key) : null;
      if (!cached || Date.now() - cached.fetchedAt > PLACE_KEEP_MS) storage.remove(key);
    }
  } catch {
    // Eviction is housekeeping; a failure must not block the forecast.
  }
}

/** A place's forecast and hourly outlook, kept on the phone (MMKV) for 6 hours; falls back to an older copy offline. */
export function getPlaceWeather(coords: LatLng): Promise<PlaceWeather | null> {
  const key = cacheKey(coords);
  const cached = readCache(key);
  if (cached && Date.now() - cached.fetchedAt < PLACE_FRESH_MS) return Promise.resolve(cached.data);

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = fetchPlaceWeather(coords)
    .then((data) => {
      if (!data?.days.length) return cached && Date.now() - cached.fetchedAt < PLACE_KEEP_MS ? cached.data : null;
      evictStaleCache();
      storage.set(key, JSON.stringify({ fetchedAt: Date.now(), data } satisfies CachedPlace));
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

/** Conditions now from a place's hourly outlook; null if the outlook doesn't cover now. */
export function weatherNow(place: PlaceWeather, now = Date.now()) {
  const started = place.hours.filter((hour) => hour.t <= now);
  const hour = started[started.length - 1] ?? (place.hours[0] && place.hours[0].t - now < 3_600_000 ? place.hours[0] : undefined);
  return hour && now - hour.t <= 2 * 3_600_000 ? hour : null;
}

/** Daily forecast for a destination within `start`..`end` (YYYY-MM-DD); null when unavailable. */
export async function getDailyForecast(coords: LatLng, start: string, end: string): Promise<DailyForecast[] | null> {
  const place = await getPlaceWeather(coords);
  const inRange = place?.days.filter((day) => day.date >= start && day.date <= end) ?? [];
  return inRange.length ? inRange : null;
}
