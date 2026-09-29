import * as Location from "expo-location";
import * as Battery from "expo-battery";
import { defineTask } from "expo-task-manager";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { storage } from "@/stores/storage";
import { authClient } from "@/features/auth/services/authClient";
import { translate } from "@/localization/translate";
import { logger } from "@/services/logger";
import { getIntervalForMode, type BroadcastMode } from "../store/sharingStore";

export const BROADCAST_TASK_NAME = "nomadsafe-location-broadcast";

const STATE_KEY = "sharing-broadcast-state";
const LAST_BROADCAST_KEY = "sharing-last-broadcast";
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

interface BroadcastState {
  isBroadcasting: boolean;
  mode: BroadcastMode;
  lastPublishedAt: number | null;
  lastError: string | null;
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

let cachedJwt: { token: string; expiresAt: number } | null = null;

/** Exchanges the stored Better Auth session cookie for a short-lived Convex JWT. */
async function getConvexJwt(): Promise<string | null> {
  if (cachedJwt && cachedJwt.expiresAt - Date.now() > 60_000) return cachedJwt.token;
  if (!siteUrl) return null;
  const cookie = authClient.getCookie();
  if (!cookie) return null;

  const res = await fetch(`${siteUrl}/api/auth/convex/token`, {
    headers: { cookie },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) return null;

  let expiresAt = Date.now() + 10 * 60_000;
  try {
    const payload = JSON.parse(atob(body.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (payload.exp) expiresAt = payload.exp * 1000;
  } catch {}
  cachedJwt = { token: body.token, expiresAt };
  return body.token;
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
  let error: string | null = null;
  let failure: unknown;

  try {
    const jwt = convexUrl ? await getConvexJwt() : null;
    if (!jwt || !convexUrl) {
      error = "not_authenticated";
    } else {
      const client = new ConvexHttpClient(convexUrl);
      client.setAuth(jwt);
      await client.mutation(api.sharing.publishLocation, {
        latitude,
        longitude,
        mode,
        battery: await readBattery(),
      });
      ok = true;
    }
  } catch (err) {
    cachedJwt = null;
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
  writeBroadcastState(ok ? { lastPublishedAt: now, lastError: null } : { lastError: error });
  return ok;
}

defineTask(BROADCAST_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  const state = readBroadcastState();
  if (!state.isBroadcasting) return;

  const intervalMs = getIntervalForMode(state.mode) * 1000;
  // Small tolerance so OS batching jitter doesn't skip every other update.
  if (state.lastPublishedAt && Date.now() - state.lastPublishedAt < intervalMs * 0.8) return;

  const last = locations[locations.length - 1];
  await publishLocation(last.coords.latitude, last.coords.longitude, state.mode);
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
 */
export async function startLocationBroadcast(mode: BroadcastMode) {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error("Location permission denied");

  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new BackgroundLocationDeniedError();

  if (await Location.hasStartedLocationUpdatesAsync(BROADCAST_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(BROADCAST_TASK_NAME);
  }

  writeBroadcastState({ isBroadcasting: true, mode, lastPublishedAt: null });

  await Location.startLocationUpdatesAsync(BROADCAST_TASK_NAME, {
    accuracy:
      mode === "emergency"
        ? Location.Accuracy.BestForNavigation
        : mode === "low"
          ? Location.Accuracy.Balanced
          : Location.Accuracy.High,
    timeInterval: getIntervalForMode(mode) * 1000,
    distanceInterval: mode === "emergency" ? 10 : mode === "low" ? 200 : 50,
    foregroundService: {
      notificationTitle: translate("sharing.serviceTitle"),
      notificationBody: translate("sharing.serviceBody"),
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
  });

  try {
    const current = await Location.getCurrentPositionAsync({
      accuracy: mode === "low" ? Location.Accuracy.Balanced : Location.Accuracy.High,
    });
    await publishLocation(current.coords.latitude, current.coords.longitude, mode);
  } catch {
    // The task will publish on the next OS location update.
  }
}

/** Stops the task and marks shares inactive server-side (best-effort). */
export async function stopLocationBroadcast() {
  writeBroadcastState({ isBroadcasting: false });
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BROADCAST_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(BROADCAST_TASK_NAME);
    }
  } finally {
    try {
      const jwt = convexUrl ? await getConvexJwt() : null;
      if (jwt && convexUrl) {
        const client = new ConvexHttpClient(convexUrl);
        client.setAuth(jwt);
        await client.mutation(api.sharing.stopSharing, {});
      }
    } catch {}
  }
}

export async function isLocationBroadcastRunning() {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BROADCAST_TASK_NAME);
  } catch {
    return false;
  }
}

export function clearBroadcastState() {
  cachedJwt = null;
  storage.remove(STATE_KEY);
  storage.remove(LAST_BROADCAST_KEY);
}
