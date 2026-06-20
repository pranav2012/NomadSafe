import * as SecureStore from "expo-secure-store";

const KEY = "nomadsafe.itinerary.last-sync-at";
const PARSER_VERSION = 1;

interface ItinerarySyncState {
  lastSyncAt: number;
  parserVersion: number;
}

export async function loadItineraryLastSyncAt(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as ItinerarySyncState;
    return state.parserVersion === PARSER_VERSION && Number.isFinite(state.lastSyncAt)
      ? state.lastSyncAt
      : null;
  } catch {
    return null;
  }
}

export async function saveItineraryLastSyncAt(timestamp: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      KEY,
      JSON.stringify({ lastSyncAt: timestamp, parserVersion: PARSER_VERSION }),
    );
  } catch {
    // A failed checkpoint only causes a safe, deduplicated rescan.
  }
}
