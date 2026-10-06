import * as Battery from "expo-battery";
import { api, clearConvexJwt, createBackendHttpClient, getConvexJwt } from "@/modules/backend";
import {
  defineLocationTask,
  getCurrentPosition,
  hasStartedLocationUpdates,
  requestBackgroundPermission,
  requestForegroundPermission,
  startLocationUpdates,
  stopLocationUpdates,
  type BackgroundUpdateOptions,
} from "@/modules/location";
import { storage } from "@/modules/storage";
import { translate } from "@/localization/translate";
import { logger } from "@/modules/logger";
import { getIntervalForMode, type BroadcastMode } from "../store/sharingStore";
import { batteryMode } from "../utils/circle";

export const BROADCAST_TASK_NAME = "nomadsafe-location-broadcast";

const STATE_KEY = "sharing-broadcast-state";
// Manually picked emergency mode drops back to normal after this long (an active SOS is exempt).
export const EMERGENCY_LIMIT_MS = 60 * 60_000;
// Consecutive publishes that reached nobody before sharing stops itself.
const MAX_IDLE_PUBLISHES = 3;
const LAST_BROADCAST_KEY = "sharing-last-broadcast";

interface BroadcastState {
  isBroadcasting: boolean;
  mode: BroadcastMode;
  lastPublishedAt: number | null;
  lastError: string | null;
  /** Sharing stops itself at this time; null means until the user stops it. */
  expiresAt: number | null;
  /** Emergency mode steps down to normal at this time; null when not limited (normal/low, or SOS). */
  emergencyUntil: number | null;
  idlePublishes: number;
}

export interface LastBroadcast {
  latitude: number;
  longitude: number;
  timestamp: number;
  mode: BroadcastMode;
  ok: boolean;
}

const DEFAULT_STATE: BroadcastState = {
  isBroadcasting: false,
  mode: "normal",
  lastPublishedAt: null,
  lastError: null,
  expiresAt: null,
  emergencyUntil: null,
  idlePublishes: 0,
};

// Kept under its own key so the background task never overwrites UI store state.
export function readBroadcastState(): BroadcastState {
  const raw = storage.getString(STATE_KEY);
  if (!raw) return DEFAULT_STATE;
  try {
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<BroadcastState>) };
  } catch {
    return DEFAULT_STATE;
  }
}

function writeBroadcastState(patch: Partial<BroadcastState>) {
  storage.set(STATE_KEY, JSON.stringify({ ...readBroadcastState(), ...patch }));
}

export function readLastBroadcast(): LastBroadcast | null {
  const raw = storage.getString(LAST_BROADCAST_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastBroadcast;
  } catch {
    return null;
  }
}

async function readBattery(): Promise<number | undefined> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? level : undefined;
  } catch {
    return undefined;
  }
}

export async function publishLocation(
  latitude: number,
  longitude: number,
  mode: BroadcastMode,
): Promise<boolean> {
  const now = Date.now();
  let ok = false;
  let recipients: number | null = null;
  let error: string | null = null;
  let failure: unknown;

  try {
    const jwt = await getConvexJwt();
    if (!jwt) {
      error = "not_authenticated";
    } else {
      const client = createBackendHttpClient(jwt);
      const result = await client.mutation(api.sharing.publishLocation, {
        latitude,
        longitude,
        mode,
        battery: await readBattery(),
        endsAt: readBroadcastState().expiresAt ?? undefined,
      });
      recipients = result.recipients;
      ok = true;
    }
  } catch (err) {
    clearConvexJwt();
    error = err instanceof Error ? err.message : "network_error";
    failure = err;
  }
  // Only the first failure of a streak, so a long offline stretch doesn't log every interval.
  if (!ok && !readBroadcastState().lastError) {
    logger.warn("location-broadcast", "publish failed", failure, { mode, authenticated: error !== "not_authenticated" });
  }

  storage.set(
    LAST_BROADCAST_KEY,
    JSON.stringify({ latitude, longitude, timestamp: now, mode, ok } satisfies LastBroadcast),
  );
  const idle = recipients === 0 ? readBroadcastState().idlePublishes + 1 : recipients === null ? readBroadcastState().idlePublishes : 0;
  writeBroadcastState(ok ? { lastPublishedAt: now, lastError: null, idlePublishes: idle } : { lastError: error });
  return ok;
}

function locationOptions(mode: BroadcastMode): BackgroundUpdateOptions {
  const interval = getIntervalForMode(mode) * 1000;
  return {
    // GPS only for emergencies; normal and low use network/Wi-Fi fixes, which cost far less power.
    accuracy: mode === "emergency" ? "navigation" : mode === "low" ? "low" : "balanced",
    timeInterval: interval,
    distanceInterval: mode === "emergency" ? 10 : mode === "low" ? 200 : 50,
    // Batches fixes so the JS task wakes about once per interval instead of once per fix.
    deferredUpdatesInterval: mode === "emergency" ? undefined : interval,
    foregroundService: {
      title: translate("sharing.serviceTitle"),
      body: translate("sharing.serviceBody"),
      killServiceOnDestroy: false,
    },
    // iOS won't resume paused updates from the background, so a safety share must never pause.
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  };
}

/**
 * Applies the share's time limits: stops it once expired or once it has reached nobody for a while,
 * steps emergency mode down to normal, and switches between normal and low with the battery.
 * Returns false when sharing has stopped.
 */
export async function enforceBroadcastLimits(): Promise<boolean> {
  const state = readBroadcastState();
  if (!state.isBroadcasting) return false;
  const now = Date.now();
  if ((state.expiresAt && now >= state.expiresAt) || state.idlePublishes >= MAX_IDLE_PUBLISHES) {
    await stopLocationBroadcast();
    return false;
  }
  if (state.mode === "emergency" && state.emergencyUntil && now >= state.emergencyUntil) {
    await switchMode("normal", { emergencyUntil: null });
    return true;
  }
  const next = batteryMode(state.mode, await readBattery());
  if (next !== state.mode) await switchMode(next);
  return true;
}

async function switchMode(mode: BroadcastMode, patch: Partial<BroadcastState> = {}) {
  writeBroadcastState({ ...patch, mode });
  try {
    await startLocationUpdates(BROADCAST_TASK_NAME, locationOptions(mode));
  } catch {
    // Publishing still uses the new interval; the next foreground start applies the options.
  }
}

defineLocationTask(BROADCAST_TASK_NAME, async (positions) => {
  if (!(await enforceBroadcastLimits())) return;
  const state = readBroadcastState();

  const intervalMs = getIntervalForMode(state.mode) * 1000;
  // Small tolerance so OS batching jitter doesn't skip every other update.
  if (state.lastPublishedAt && Date.now() - state.lastPublishedAt < intervalMs * 0.8) return;

  const last = positions[positions.length - 1];
  await publishLocation(last.latitude, last.longitude, state.mode);
});

export class BackgroundLocationDeniedError extends Error {
  constructor() {
    super("Background location permission denied");
    this.name = "BackgroundLocationDeniedError";
  }
}

/**
 * Starts the foreground-service location task and publishes an immediate
 * first update. Callers must show the background-location disclosure first.
 * `expiresAt` ends the share automatically; `sos` exempts emergency mode from its time limit.
 */
export async function startLocationBroadcast(
  mode: BroadcastMode,
  { expiresAt = null, sos = false }: { expiresAt?: number | null; sos?: boolean } = {},
) {
  const foreground = await requestForegroundPermission();
  if (!foreground.granted) throw new Error("Location permission denied");

  const background = await requestBackgroundPermission();
  if (!background.granted) throw new BackgroundLocationDeniedError();

  if (await hasStartedLocationUpdates(BROADCAST_TASK_NAME)) {
    await stopLocationUpdates(BROADCAST_TASK_NAME);
  }

  mode = batteryMode(mode, await readBattery());
  writeBroadcastState({
    isBroadcasting: true,
    mode,
    lastPublishedAt: null,
    expiresAt,
    emergencyUntil: mode === "emergency" && !sos ? Date.now() + EMERGENCY_LIMIT_MS : null,
    idlePublishes: 0,
  });

  await startLocationUpdates(BROADCAST_TASK_NAME, locationOptions(mode));

  try {
    const current = await getCurrentPosition(mode === "emergency" ? "high" : "balanced");
    await publishLocation(current.latitude, current.longitude, mode);
  } catch {
    // The task will publish on the next OS location update.
  }
}

/** Stops the task and marks shares inactive server-side (best-effort). */
export async function stopLocationBroadcast() {
  writeBroadcastState({ isBroadcasting: false, expiresAt: null, emergencyUntil: null, idlePublishes: 0 });
  try {
    if (await hasStartedLocationUpdates(BROADCAST_TASK_NAME)) {
      await stopLocationUpdates(BROADCAST_TASK_NAME);
    }
  } finally {
    try {
      const jwt = await getConvexJwt();
      if (jwt) {
        await createBackendHttpClient(jwt).mutation(api.sharing.stopSharing, {});
      }
    } catch {}
  }
}

export async function isLocationBroadcastRunning() {
  try {
    return await hasStartedLocationUpdates(BROADCAST_TASK_NAME);
  } catch {
    return false;
  }
}

export function clearBroadcastState() {
  clearConvexJwt();
  storage.remove(STATE_KEY);
  storage.remove(LAST_BROADCAST_KEY);
}
