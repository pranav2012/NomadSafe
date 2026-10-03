import * as Location from "expo-location";
import * as SMS from "expo-sms";
import { Linking, Platform } from "react-native";
import {
  BackgroundLocationDeniedError,
  readBroadcastState,
  startLocationBroadcast,
  stopLocationBroadcast,
  useSharingStore,
  type BroadcastMode,
} from "@/features/location-sharing";
import { hasAcceptedBackgroundDisclosure } from "@/features/location-sharing/components/BackgroundLocationDisclosure";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { normalizePhone, isValidPhone } from "../utils/phone";
import { readLastKnownFix, saveLastKnownFix } from "./lastKnownLocation";
import { logger } from "@/services/logger";

export type SmsOutcome = "sent" | "cancelled" | "opened" | "failed";

export interface AlertPosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number | null;
  source: "fresh" | "lastKnown" | "cached";
}

export interface BroadcastSnapshot {
  wasBroadcasting: boolean;
  mode: BroadcastMode;
  expiresAt: number | null;
}

const FRESH_FIX_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** Unique, normalized phone numbers of emergency contacts that can receive SMS. */
export function getContactPhones(): string[] {
  const phones = emergencyContactsStorage
    .get()
    .map((c) => normalizePhone(c.phone))
    .filter((p): p is string => !!p && isValidPhone(p));
  return Array.from(new Set(phones));
}

type CachedPosition = { latitude: number; longitude: number; accuracy?: number | null; timestamp?: number | null };

function newest(a: CachedPosition | null, b: CachedPosition | null): CachedPosition | null {
  if (!a) return b;
  if (!b) return a;
  return (b.timestamp ?? 0) > (a.timestamp ?? 0) ? b : a;
}

/**
 * Best-effort position for an alert: fresh GPS fix (10 s cap), else the newest
 * of the OS last-known fix, our persisted fix and the screen's coordinates.
 * Every real fix is persisted for offline use. Never throws.
 */
export async function getBestPosition(cached: CachedPosition | null): Promise<AlertPosition | null> {
  let osLastAt: number | null = null;
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) {
      const fresh = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
        FRESH_FIX_TIMEOUT_MS,
      );
      if (fresh) {
        const fix = {
          latitude: fresh.coords.latitude,
          longitude: fresh.coords.longitude,
          accuracy: fresh.coords.accuracy ?? null,
          timestamp: fresh.timestamp,
        };
        saveLastKnownFix(fix);
        return { ...fix, source: "fresh" };
      }
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) {
        osLastAt = last.timestamp;
        saveLastKnownFix({
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
          accuracy: last.coords.accuracy ?? null,
          timestamp: last.timestamp,
        });
      }
    }
  } catch {
    // Location services off or permission API failure; fall through.
  }
  const best = newest(readLastKnownFix(), cached);
  if (!best) return null;
  return {
    latitude: best.latitude,
    longitude: best.longitude,
    accuracy: best.accuracy ?? null,
    timestamp: best.timestamp ?? null,
    source: osLastAt != null && best.timestamp === osLastAt ? "lastKnown" : "cached",
  };
}

export function buildMapsUrl(position: { latitude: number; longitude: number }) {
  const lat = position.latitude.toFixed(6);
  const lng = position.longitude.toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/**
 * Opens the SMS composer for the given recipients. Uses expo-sms when available,
 * otherwise an sms: URL. Android can't report delivery, so it resolves "opened".
 */
export async function composeSms(phones: string[], body: string): Promise<SmsOutcome> {
  if (phones.length === 0) return "failed";
  try {
    if (await SMS.isAvailableAsync()) {
      const { result } = await SMS.sendSMSAsync(phones, body);
      if (result === "sent") return "sent";
      if (result === "cancelled") return "cancelled";
      return "opened";
    }
  } catch (err) {
    logger.warn("sos", "expo-sms failed, falling back to sms: URL", err);
  }
  try {
    const encoded = encodeURIComponent(body);
    const url = Platform.OS === "ios"
      ? `sms:/open?addresses=${phones.join(",")}&body=${encoded}`
      : `sms:${phones.join(";")}?body=${encoded}`;
    await Linking.openURL(url);
    return "opened";
  } catch (err) {
    logger.error("sos", "sms: URL fallback failed", err);
    return "failed";
  }
}

export function snapshotBroadcast(): BroadcastSnapshot {
  const { isBroadcasting, mode } = useSharingStore.getState();
  return { wasBroadcasting: isBroadcasting, mode, expiresAt: readBroadcastState().expiresAt };
}

export async function hasBackgroundLocationPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * True only when emergency sharing can start without any permission prompt:
 * "Allow all the time" is already granted and the disclosure was accepted.
 */
export async function canAutoStartEmergencyBroadcast(): Promise<boolean> {
  return hasAcceptedBackgroundDisclosure() && (await hasBackgroundLocationPermission());
}

/**
 * Switches live location sharing to emergency mode. Resolves "denied" when
 * "Allow all the time" location isn't granted. Never throws.
 */
export async function startEmergencyBroadcast(): Promise<"started" | "denied" | "failed"> {
  try {
    await startLocationBroadcast("emergency", { sos: true });
    const sharing = useSharingStore.getState();
    sharing.setMode("emergency");
    sharing.setBroadcasting(true);
    return "started";
  } catch (err) {
    if (err instanceof BackgroundLocationDeniedError) return "denied";
    logger.error("sos", "emergency location broadcast failed", err);
    return "failed";
  }
}

/** Returns live sharing to how it was before the SOS. Never throws. */
export async function restoreBroadcast(previous: BroadcastSnapshot | null) {
  const sharing = useSharingStore.getState();
  try {
    if (previous?.wasBroadcasting) {
      sharing.setMode(previous.mode);
      await startLocationBroadcast(previous.mode, { expiresAt: previous.expiresAt });
    } else {
      await stopLocationBroadcast();
      sharing.setBroadcasting(false);
      sharing.setMode(previous?.mode ?? "normal");
    }
  } catch (err) {
    logger.warn("sos", "failed to restore location broadcast", err);
    await stopLocationBroadcast().catch(() => {});
    sharing.setBroadcasting(false);
  }
}
