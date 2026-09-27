import { storage } from "@/stores/storage";

export interface StoredFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
}

const KEY = "safety.last-known-fix";

function isStoredFix(value: unknown): value is StoredFix {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.latitude === "number" && typeof v.longitude === "number" && typeof v.timestamp === "number";
}

/** Last good GPS fix persisted across launches, for offline SOS. */
export function readLastKnownFix(): StoredFix | null {
  const raw = storage.getString(KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredFix(parsed) ? { ...parsed, accuracy: parsed.accuracy ?? null } : null;
  } catch {
    return null;
  }
}

/** Persists the fix unless an equally new or newer one is already stored. */
export function saveLastKnownFix(fix: StoredFix) {
  const current = readLastKnownFix();
  if (current && current.timestamp >= fix.timestamp) return;
  storage.set(KEY, JSON.stringify(fix));
}
