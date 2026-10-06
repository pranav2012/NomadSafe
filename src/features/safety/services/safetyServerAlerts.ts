import { api, convex } from "@/modules/backend";
import { logger } from "@/modules/logger";
import { notifications } from "@/modules/notifications";
import { storage } from "@/modules/storage";
import { useSafetyStore } from "../store/safetyStore";

/** Must match CHANNEL_ID in convex/safetyAlerts.ts. */
export const SAFETY_ALERT_CHANNEL_ID = "safety-alerts";
/** Must match CHECK_IN_GRACE_MS in convex/safetyAlerts.ts. */
export const CHECK_IN_ALERT_GRACE_MS = 5 * 60_000;

const LEDGER_KEY = "safety.server-check-in";
const SOS_ALERT_TIMEOUT_MS = 8_000;
const SERVER_CALL_TIMEOUT_MS = 8_000;

/** Android channel for SOS / missed check-in pushes from contacts; created before any can arrive. */
export async function ensureSafetyAlertChannel(name: string) {
  await notifications.setChannel(SAFETY_ALERT_CHANNEL_ID, {
    name,
    importance: "max",
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lockscreenVisibility: "public",
  }).catch(() => {});
}

function desiredDeadline(): number | null {
  const { status, checkInEndsAt } = useSafetyStore.getState();
  return status === "active" && checkInEndsAt ? checkInEndsAt : null;
}

let syncChain: Promise<void> = Promise.resolve();

/**
 * Mirrors the running check-in's deadline to the server, which alerts linked contacts if it
 * passes. Compares against the last value the server accepted, so it's a no-op when nothing
 * changed and retries on the next call after a failure. Calls are serialized.
 */
export function syncCheckInDeadline(): Promise<void> {
  syncChain = syncChain.then(async () => {
    const endsAt = desiredDeadline();
    const key = endsAt === null ? "none" : String(endsAt);
    if ((storage.getString(LEDGER_KEY) ?? "none") === key) return;
    try {
      await convex.mutation(api.safetyAlerts.setCheckIn, { endsAt });
      storage.set(LEDGER_KEY, key);
    } catch (err) {
      logger.warn("safety-alerts", "check-in sync failed", err);
    }
  });
  return syncChain;
}

/** Clears the server deadline before sign-out so contacts aren't alerted for a signed-out phone. */
export async function clearServerCheckIn() {
  if ((storage.getString(LEDGER_KEY) ?? "none") === "none") return;
  try {
    // Convex queues calls while offline instead of failing, so give up after a while.
    const cleared = await Promise.race([
      convex.mutation(api.safetyAlerts.setCheckIn, { endsAt: null }).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), SERVER_CALL_TIMEOUT_MS)),
    ]);
    if (cleared) {
      storage.remove(LEDGER_KEY);
      return;
    }
    logger.warn("safety-alerts", "check-in clear timed out; server deadline may still alert contacts");
  } catch (err) {
    logger.warn("safety-alerts", "check-in clear failed; server deadline may still alert contacts", err);
  }
}

/**
 * Alerts linked contacts about an SOS. Resolves the number of linked contacts, or null if the server
 * didn't answer in time. Convex keeps the call queued while offline, so `onLate` gets the count if it
 * goes through after that.
 */
export async function alertContactsSos(onLate?: (recipients: number) => void): Promise<number | null> {
  try {
    const call = convex.mutation(api.safetyAlerts.triggerSos, {});
    const result = await Promise.race([
      call,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SOS_ALERT_TIMEOUT_MS)),
    ]);
    if (result === null) {
      call.then((late) => onLate?.(late.recipients)).catch((err) => logger.warn("safety-alerts", "late SOS alert failed", err));
    }
    return result?.recipients ?? null;
  } catch (err) {
    logger.warn("safety-alerts", "SOS alert failed", err);
    return null;
  }
}

/** Tells contacts who got the SOS alert that the user is safe. */
export function resolveSosOnServer() {
  convex.mutation(api.safetyAlerts.resolveSos, {}).catch((err) => logger.warn("safety-alerts", "SOS resolve failed", err));
}

/** One location update in emergency mode, so contacts see where the SOS came from even if live sharing can't start. */
export function publishSosPosition(position: { latitude: number; longitude: number }) {
  convex
    .mutation(api.sharing.publishLocation, { latitude: position.latitude, longitude: position.longitude, mode: "emergency" })
    .catch((err) => logger.warn("safety-alerts", "SOS position publish failed", err));
}
