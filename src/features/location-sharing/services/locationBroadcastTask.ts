import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Network from "expo-network";
import { api, clearConvexJwt, getBackendHttpClient, getConvexJwt } from "@/modules/backend";
import {
  defineGeofenceExitTask,
  defineLocationTask,
  definePeriodicTask,
  getCurrentPosition,
  hasStartedLocationUpdates,
  registerPeriodicTask,
  requestBackgroundPermission,
  requestForegroundPermission,
  startGeofence,
  startLocationUpdates,
  stopGeofence,
  stopLocationUpdates,
  unregisterPeriodicTask,
  type BackgroundUpdateOptions,
} from "@/modules/location";
import { storage } from "@/modules/storage";
import { translate } from "@/localization/translate";
import { logger } from "@/modules/logger";
import type { BroadcastMode } from "../store/sharingStore";
import {
  chooseProfile,
  initialProfile,
  isAuthError,
  MAX_FIX_ACCURACY_M,
  profileSpec,
  publishDecision,
  roundBattery,
  STILL_MOTION,
  STILL_RADIUS_M,
  updateMotion,
  type BroadcastProfile,
  type Motion,
  type ProfileSpec,
} from "../utils/broadcastPolicy";
import { batteryMode } from "../utils/circle";

export const BROADCAST_TASK_NAME = "nomadsafe-location-broadcast";
const GEOFENCE_TASK_NAME = "nomadsafe-location-still-fence";
const WATCHDOG_TASK_NAME = "nomadsafe-location-watchdog";

const STATE_KEY = "sharing-broadcast-state";
// Manually picked emergency mode drops back to normal after this long (an active SOS is exempt).
export const EMERGENCY_LIMIT_MS = 60 * 60_000;
// Consecutive publishes that reached nobody before sharing stops itself.
const MAX_IDLE_PUBLISHES = 3;
const LAST_BROADCAST_KEY = "sharing-last-broadcast";
const PLATFORM = Platform.OS === "ios" ? "ios" : "android";
// Android reports an exit right away if its own estimate starts outside the fence; fixes cover that window.
const FENCE_SETTLE_MS = 2 * 60_000;

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
  /** The location profile the OS updates were last started with. */
  profile: BroadcastProfile | null;
  motion: Motion;
  lastAttemptAt: number | null;
  /** Failed publishes in a row, for the retry backoff. */
  failures: number;
  fenceStartedAt: number | null;
}

/** The last position that reached the server. */
export interface LastBroadcast {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
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
  profile: null,
  motion: STILL_MOTION,
  lastAttemptAt: null,
  failures: 0,
  fenceStartedAt: null,
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

async function isOffline(): Promise<boolean> {
  try {
    return (await Network.getNetworkStateAsync()).isConnected === false;
  } catch {
    return false;
  }
}

/**
 * Sends one position to everyone who sees you. Failures are counted for the retry backoff; the
 * cached token is dropped only when the server rejected it.
 */
export async function publishLocation(
  position: { latitude: number; longitude: number; accuracy?: number | null },
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
      const result = await getBackendHttpClient(jwt).mutation(api.sharing.publishLocation, {
        latitude: position.latitude,
        longitude: position.longitude,
        mode,
        battery: roundBattery(await readBattery()),
        endsAt: readBroadcastState().expiresAt ?? undefined,
      });
      recipients = result.recipients;
      ok = true;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "network_error";
    failure = err;
    if (isAuthError(error)) clearConvexJwt();
  }
  const state = readBroadcastState();
  // Only the first failure of a streak, so a long offline stretch doesn't log every interval.
  if (!ok && !state.lastError) {
    logger.warn("location-broadcast", "publish failed", failure, { mode, authenticated: error !== "not_authenticated" });
  }

  if (!ok) {
    writeBroadcastState({ lastError: error, lastAttemptAt: now, failures: state.failures + 1 });
    return false;
  }
  storage.set(
    LAST_BROADCAST_KEY,
    JSON.stringify({
      latitude: position.latitude,
      longitude: position.longitude,
      accuracy: position.accuracy ?? null,
      timestamp: now,
      mode,
      ok,
    } satisfies LastBroadcast),
  );
  const idle = recipients === 0 ? state.idlePublishes + 1 : 0;
  writeBroadcastState({ lastPublishedAt: now, lastError: null, idlePublishes: idle, lastAttemptAt: now, failures: 0 });
  return true;
}

function locationOptions(spec: ProfileSpec): BackgroundUpdateOptions {
  return {
    accuracy: spec.accuracy,
    timeInterval: spec.timeInterval,
    distanceInterval: spec.distanceInterval,
    deferredUpdatesInterval: spec.deferredUpdatesInterval,
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
 * (Re)starts the OS updates for the profile that fits the mode and motion, and the geofence that
 * notices leaving a still point. Does nothing when the profile hasn't changed, unless `force`.
 */
async function applyProfile(mode: BroadcastMode, motion: Motion, force = false) {
  const profile = chooseProfile(mode, motion);
  if (!force && profile === readBroadcastState().profile) return;
  writeBroadcastState({ profile, motion });
  const spec = profileSpec(profile, PLATFORM);
  try {
    await startLocationUpdates(BROADCAST_TASK_NAME, locationOptions(spec));
  } catch (err) {
    // Publishing still follows the new profile; the next foreground start applies the options.
    logger.warn("location-broadcast", "profile restart failed", err, { profile });
  }
  try {
    if (spec.geofence && motion.anchor) {
      await startGeofence(GEOFENCE_TASK_NAME, {
        latitude: motion.anchor.latitude,
        longitude: motion.anchor.longitude,
        radius: STILL_RADIUS_M,
      });
      writeBroadcastState({ fenceStartedAt: Date.now() });
    } else {
      await stopGeofence(GEOFENCE_TASK_NAME);
    }
  } catch (err) {
    logger.warn("location-broadcast", "geofence update failed", err, { profile });
  }
}

/**
 * Applies the share's time limits: stops it once expired or once it has reached nobody for a while,
 * steps emergency mode down to normal, and switches between normal and low with the battery.
 * Returns false when sharing has stopped.
 */
export async function enforceBroadcastLimits(): Promise<boolean> {
  const state = readBroadcastState();
  if (!state.isBroadcasting) {
    void unregisterPeriodicTask(WATCHDOG_TASK_NAME);
    return false;
  }
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
  await applyProfile(mode, readBroadcastState().motion);
}

defineLocationTask(BROADCAST_TASK_NAME, async (positions) => {
  if (!(await enforceBroadcastLimits())) return;
  const fixes = positions.filter((p) => p.accuracy == null || p.accuracy <= MAX_FIX_ACCURACY_M);
  if (!fixes.length) return;

  const before = readBroadcastState();
  const motion = fixes.reduce(updateMotion, before.motion);
  writeBroadcastState({ motion });
  await applyProfile(before.mode, motion);

  const state = readBroadcastState();
  const fix = fixes[fixes.length - 1];
  const decision = publishDecision({
    fix,
    last: readLastBroadcast(),
    lastPublishedAt: state.lastPublishedAt,
    lastAttemptAt: state.lastAttemptAt,
    // During an SOS the offline check alone keeps retries in check; never wait out a backoff.
    failures: state.mode === "emergency" ? 0 : state.failures,
    spec: profileSpec(state.profile ?? initialProfile(state.mode), PLATFORM),
    now: Date.now(),
  });
  if (decision !== "publish" || (await isOffline())) return;
  await publishLocation(fix, state.mode);
});

// Leaving the still point: back to the moving profile right away instead of waiting for a slow fix.
defineGeofenceExitTask(GEOFENCE_TASK_NAME, async () => {
  if (!(await enforceBroadcastLimits())) return;
  const state = readBroadcastState();
  if (!state.motion.still || (state.fenceStartedAt && Date.now() - state.fenceStartedAt < FENCE_SETTLE_MS)) return;
  await applyProfile(state.mode, STILL_MOTION);
});

// Ends expired or idle shares even when no fix arrives (e.g. a still phone).
definePeriodicTask(WATCHDOG_TASK_NAME, async () => {
  await enforceBroadcastLimits();
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
    profile: null,
    motion: STILL_MOTION,
    lastAttemptAt: null,
    failures: 0,
  });

  await applyProfile(mode, STILL_MOTION, true);
  void registerPeriodicTask(WATCHDOG_TASK_NAME, 15);

  // The first publish skips every gate (accuracy, backoff, offline), so an SOS goes out at once.
  try {
    const current = await getCurrentPosition(mode === "emergency" ? "high" : "balanced");
    await publishLocation(current, mode);
  } catch {
    // The task will publish on the next OS location update.
  }
}

/** Stops the task and marks shares inactive server-side (best-effort). */
export async function stopLocationBroadcast() {
  writeBroadcastState({
    isBroadcasting: false,
    expiresAt: null,
    emergencyUntil: null,
    idlePublishes: 0,
    profile: null,
    motion: STILL_MOTION,
    failures: 0,
    lastAttemptAt: null,
  });
  try {
    await Promise.all([
      stopGeofence(GEOFENCE_TASK_NAME).catch(() => {}),
      unregisterPeriodicTask(WATCHDOG_TASK_NAME),
    ]);
    if (await hasStartedLocationUpdates(BROADCAST_TASK_NAME)) {
      await stopLocationUpdates(BROADCAST_TASK_NAME);
    }
  } finally {
    try {
      const jwt = await getConvexJwt();
      if (jwt) {
        await getBackendHttpClient(jwt).mutation(api.sharing.stopSharing, {});
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
