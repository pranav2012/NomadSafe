import type { BroadcastMode } from "./circle";

// Pure rules for live location sharing (profiles, still detection, publish gating, backoff); tested in node.

export type BroadcastProfile = "walk" | "drive" | "still" | "low" | "sos" | "sosStill";
export type BroadcastPlatform = "ios" | "android";
export type ProfileAccuracy = "low" | "balanced" | "high";

export interface ProfileSpec {
  accuracy: ProfileAccuracy;
  timeInterval: number;
  distanceInterval: number;
  deferredUpdatesInterval: number;
  publishIntervalMs: number;
  /** Publish an unmoved position after this long so contacts don't see it as stale. */
  heartbeatMs: number;
  geofence: boolean;
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  timestamp: number;
}

export interface Anchor {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  since: number;
}

export interface Motion {
  anchor: Anchor | null;
  still: boolean;
  fast: boolean;
}

export const STILL_MOTION: Motion = { anchor: null, still: false, fast: false };

const MINUTE = 60_000;
export const MAX_FIX_ACCURACY_M = 500;
/** Must stay under SHARE_STALE_AFTER_MS (15 min) so a still share never looks stale. */
export const HEARTBEAT_MS = 10 * MINUTE;
export const STILL_AFTER_MS = 5 * MINUTE;
export const STILL_RADIUS_M = 150;
const MIN_MOVE_M = 50;
const DRIVE_SPEED = 7;
const WALK_SPEED = 4;
const MOVING_SPEED = 1.5;
const LEAVE_STILL_SPEED = 2;
const MAX_BACKOFF_MS = 8 * MINUTE;

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Android hands batched fixes to JS once they span the interval since the last batch; a little under
// the fix interval so a batch isn't held back a whole extra interval by timing jitter.
function batch(interval: number) {
  return Math.round(interval * 0.9);
}

function validSpeed(speed: number | null) {
  return speed != null && Number.isFinite(speed) && speed >= 0 ? speed : null;
}

/**
 * Folds one fix into the motion state. The phone is still once its fixes stay within
 * max(50 m, accuracy) (capped at 150 m) of one point for 5 minutes, and stops being still when a
 * fix lands outside the 150 m still radius or it reports walking speed with a good fix.
 */
export function updateMotion(prev: Motion, fix: Fix): Motion {
  const speed = validSpeed(fix.speed);
  const here: Anchor = { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, since: fix.timestamp };
  const fast = speed == null ? prev.fast : speed >= DRIVE_SPEED ? true : speed < WALK_SPEED ? false : prev.fast;
  if (!prev.anchor) return { anchor: here, still: false, fast };

  const distance = distanceMeters(prev.anchor, fix);
  if (prev.still) {
    const precise = fix.accuracy != null && fix.accuracy <= 100;
    const left = distance > Math.max(STILL_RADIUS_M, fix.accuracy ?? 0) || (precise && speed != null && speed >= LEAVE_STILL_SPEED);
    return left ? { anchor: here, still: false, fast } : { ...prev, fast: false };
  }

  const tolerance = Math.min(STILL_RADIUS_M, Math.max(MIN_MOVE_M, fix.accuracy ?? 0, prev.anchor.accuracy ?? 0));
  if (distance > tolerance) return { anchor: here, still: false, fast };
  const settled = fix.timestamp - prev.anchor.since >= STILL_AFTER_MS && !(speed != null && speed >= MOVING_SPEED);
  return settled ? { anchor: prev.anchor, still: true, fast: false } : { anchor: prev.anchor, still: false, fast };
}

export function chooseProfile(mode: BroadcastMode, motion: Motion): BroadcastProfile {
  if (mode === "emergency") return motion.still ? "sosStill" : "sos";
  if (motion.still) return "still";
  if (mode === "low") return "low";
  return motion.fast ? "drive" : "walk";
}

export function profileSpec(profile: BroadcastProfile, platform: BroadcastPlatform): ProfileSpec {
  const moving = { distanceInterval: 0, heartbeatMs: HEARTBEAT_MS, geofence: false };
  switch (profile) {
    case "drive":
      return { ...moving, accuracy: "balanced", timeInterval: 30_000, deferredUpdatesInterval: batch(30_000), publishIntervalMs: 30_000 };
    case "low":
      return { ...moving, accuracy: "low", timeInterval: 5 * MINUTE, deferredUpdatesInterval: batch(5 * MINUTE), publishIntervalMs: 5 * MINUTE };
    case "still":
      return {
        accuracy: "low",
        timeInterval: 10 * MINUTE,
        // iOS ignores the time interval, so a wide filter keeps it quiet; the geofence notices leaving.
        distanceInterval: platform === "ios" ? 500 : 0,
        deferredUpdatesInterval: batch(10 * MINUTE),
        publishIntervalMs: 10 * MINUTE,
        heartbeatMs: HEARTBEAT_MS,
        geofence: true,
      };
    case "sos":
      return { ...moving, accuracy: "high", timeInterval: 15_000, deferredUpdatesInterval: batch(15_000), publishIntervalMs: 15_000, heartbeatMs: 2 * MINUTE };
    case "sosStill":
      return {
        accuracy: "high",
        timeInterval: MINUTE,
        distanceInterval: 0,
        deferredUpdatesInterval: batch(MINUTE),
        publishIntervalMs: MINUTE,
        heartbeatMs: 2 * MINUTE,
        geofence: true,
      };
    case "walk":
    default:
      return { ...moving, accuracy: "balanced", timeInterval: MINUTE, deferredUpdatesInterval: batch(MINUTE), publishIntervalMs: MINUTE };
  }
}

export function initialProfile(mode: BroadcastMode): BroadcastProfile {
  return chooseProfile(mode, STILL_MOTION);
}

export interface PublishedFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  timestamp: number;
  ok: boolean;
}

export type PublishDecision = "publish" | "inaccurate" | "tooSoon" | "unmoved" | "backoff";

/**
 * Whether a fix should be published. Drops wide fixes, keeps the profile's interval since the last
 * success, skips positions within max(50 m, either accuracy) of the last published one until the
 * heartbeat is due, and waits out the backoff after failures.
 */
export function publishDecision(input: {
  fix: Fix;
  last: PublishedFix | null;
  lastPublishedAt: number | null;
  lastAttemptAt: number | null;
  failures: number;
  spec: Pick<ProfileSpec, "publishIntervalMs" | "heartbeatMs">;
  now: number;
}): PublishDecision {
  const { fix, last, lastPublishedAt, spec, now } = input;
  if (fix.accuracy != null && fix.accuracy > MAX_FIX_ACCURACY_M) return "inaccurate";
  if (input.failures > 0 && input.lastAttemptAt != null && now - input.lastAttemptAt < backoffMs(input.failures)) return "backoff";
  // Small tolerance so OS batching jitter doesn't skip every other update.
  if (lastPublishedAt != null && now - lastPublishedAt < spec.publishIntervalMs * 0.8) return "tooSoon";
  if (last?.ok && lastPublishedAt != null) {
    const threshold = Math.max(MIN_MOVE_M, fix.accuracy ?? 0, last.accuracy ?? 0);
    const heartbeatDue = now - lastPublishedAt >= spec.heartbeatMs * 0.9;
    if (!heartbeatDue && distanceMeters(last, fix) < threshold) return "unmoved";
  }
  return "publish";
}

/** Wait before retrying after `failures` publishes failed in a row: 1, 2, 4, then 8 minutes. */
export function backoffMs(failures: number) {
  if (failures <= 0) return 0;
  return Math.min(MAX_BACKOFF_MS, MINUTE * 2 ** (failures - 1));
}

/** Whether a publish error means the cached token is no good (as opposed to a network failure). */
export function isAuthError(message: string | null | undefined) {
  if (!message) return false;
  return /unauthenticated|not authenticated|\b401\b|invalid ?auth|auth(entication)? token|token (is )?(expired|invalid)|oidc|jwt/i.test(message);
}

/** Battery level (0–1) rounded to 5 %, so tiny changes don't count as a new update. */
export function roundBattery(level: number | null | undefined): number | undefined {
  if (level == null || !Number.isFinite(level) || level < 0 || level > 1) return undefined;
  return Math.round(level * 20) / 20;
}
