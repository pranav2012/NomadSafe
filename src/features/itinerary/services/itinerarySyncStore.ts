import * as SecureStore from "expo-secure-store";

const LEGACY_KEY = "nomadsafe.itinerary.last-sync-at";
export const ITINERARY_SYNC_KEY_PREFIX = "nomadsafe.itinerary.last-sync-at.";
// SecureStore can't enumerate keys, so the synced trip ids are tracked here.
const INDEX_KEY = "nomadsafe.itinerary.last-sync-index";
const PARSER_VERSION = 1;

interface ItinerarySyncState {
  lastSyncAt: number;
  parserVersion: number;
}

function keyFor(tripId: string) {
  return `${ITINERARY_SYNC_KEY_PREFIX}${tripId.replace(/[^\w.-]/g, "_")}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export async function loadItineraryLastSyncAt(tripId: string): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(tripId));
    if (!raw) return null;
    const state = JSON.parse(raw) as ItinerarySyncState;
    return state.parserVersion === PARSER_VERSION && Number.isFinite(state.lastSyncAt)
      ? state.lastSyncAt
      : null;
  } catch {
    return null;
  }
}

export async function saveItineraryLastSyncAt(tripId: string, timestamp: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      keyFor(tripId),
      JSON.stringify({ lastSyncAt: timestamp, parserVersion: PARSER_VERSION }),
    );
    const index = await readIndex();
    if (!index.includes(tripId)) {
      await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...index, tripId]));
    }
    await SecureStore.deleteItemAsync(LEGACY_KEY);
  } catch {
    // A failed checkpoint only causes a safe, deduplicated rescan.
  }
}

export async function clearItinerarySyncCheckpoint(tripId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(tripId)).catch(() => undefined);
  const index = await readIndex();
  if (index.includes(tripId)) {
    await SecureStore.setItemAsync(
      INDEX_KEY,
      JSON.stringify(index.filter((id) => id !== tripId)),
    ).catch(() => undefined);
  }
}

/** Removes every per-trip checkpoint, the index, and the legacy global key (used by wipe). */
export async function clearItinerarySyncCheckpoints(): Promise<void> {
  const index = await readIndex();
  await Promise.all(
    [...index.map(keyFor), INDEX_KEY, LEGACY_KEY].map((key) =>
      SecureStore.deleteItemAsync(key).catch(() => undefined),
    ),
  );
}
