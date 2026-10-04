import { secureStore } from "@/modules/storage";

// Checkpoints from before per-trip coverage: one app-wide for spends, one per trip for itinerary.
const EXPENSE_KEY = "nomadsafe.gmail.last-sync-at";
const ITINERARY_LEGACY_KEY = "nomadsafe.itinerary.last-sync-at";
const ITINERARY_PREFIX = "nomadsafe.itinerary.last-sync-at.";
const ITINERARY_INDEX_KEY = "nomadsafe.itinerary.last-sync-index";

let cleared = false;

/** Deletes the old Gmail sync checkpoints; safe to call repeatedly. */
export async function clearLegacyGmailCheckpoints(): Promise<void> {
  if (cleared) return;
  cleared = true;
  let tripIds: string[] = [];
  try {
    const raw = await secureStore.get(ITINERARY_INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) tripIds = parsed.filter((id): id is string => typeof id === "string");
  } catch {}
  const keys = [
    EXPENSE_KEY,
    ITINERARY_LEGACY_KEY,
    ITINERARY_INDEX_KEY,
    ...tripIds.map((id) => `${ITINERARY_PREFIX}${id.replace(/[^\w.-]/g, "_")}`),
  ];
  await Promise.all(keys.map((key) => secureStore.remove(key).catch(() => undefined)));
}
