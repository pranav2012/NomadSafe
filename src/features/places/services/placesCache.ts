import { storage } from "@/modules/storage";

const PREFIX = "places-cache:";
const TTL_MS = 6 * 60 * 60 * 1000;

interface Entry<T> {
  at: number;
  value: T;
}

/** ~1 km grid cell, so small GPS drift reuses the same cached result. */
export function areaKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

export function readPlacesCache<T>(key: string): T | undefined {
  const raw = storage.getString(PREFIX + key);
  if (!raw) return undefined;
  try {
    const entry = JSON.parse(raw) as Entry<T>;
    if (Date.now() - entry.at < TTL_MS) return entry.value;
  } catch {}
  storage.remove(PREFIX + key);
  return undefined;
}

export function writePlacesCache<T>(key: string, value: T) {
  pruneExpired();
  storage.set(PREFIX + key, JSON.stringify({ at: Date.now(), value } satisfies Entry<T>));
}

function pruneExpired() {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(PREFIX)) readPlacesCache(key.slice(PREFIX.length));
  }
}

/** Drops every cached place result (sign-out). */
export function clearPlacesCache() {
  for (const key of storage.getAllKeys()) {
    if (key.startsWith(PREFIX)) storage.remove(key);
  }
}
