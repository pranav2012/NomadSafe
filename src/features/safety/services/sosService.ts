import * as Location from "expo-location";
import * as SMS from "expo-sms";
import { Linking, Platform } from "react-native";
import {
  BackgroundLocationDeniedError,
  startLocationBroadcast,
  stopLocationBroadcast,
  useSharingStore,
  type BroadcastMode,
} from "@/features/location-sharing";
import { emergencyContactsStorage } from "@/features/onboarding/services/emergencyContactsStorage";
import { normalizePhone, isValidPhone } from "../utils/phone";

export type SmsOutcome = "sent" | "cancelled" | "opened" | "failed";

export interface AlertPosition {
  latitude: number;
  longitude: number;
  timestamp: number | null;
  source: "fresh" | "lastKnown" | "cached";
}

export interface BroadcastSnapshot {
  wasBroadcasting: boolean;
  mode: BroadcastMode;
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

/**
 * Best-effort position for an alert: fresh GPS fix (10 s cap), then the OS
 * last-known fix, then the screen's cached coordinates. Never throws.
 */
export async function getBestPosition(
  cached: { latitude: number; longitude: number; timestamp?: number | null } | null,
): Promise<AlertPosition | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.granted) {
      const fresh = await withTimeout(
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null),
        FRESH_FIX_TIMEOUT_MS,
      );
      if (fresh) {
        return {
          latitude: fresh.coords.latitude,
          longitude: fresh.coords.longitude,
          timestamp: fresh.timestamp,
          source: "fresh",
        };
      }
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) {
        return {
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
          timestamp: last.timestamp,
          source: "lastKnown",
        };
      }
    }
  } catch {
    // Location services off or permission API failure; fall through.
  }
  return cached
    ? { latitude: cached.latitude, longitude: cached.longitude, timestamp: cached.timestamp ?? null, source: "cached" }
    : null;
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
    console.warn("expo-sms failed, falling back to sms: URL", err);
  }
  try {
    const encoded = encodeURIComponent(body);
    const url = Platform.OS === "ios"
      ? `sms:/open?addresses=${phones.join(",")}&body=${encoded}`
      : `sms:${phones.join(";")}?body=${encoded}`;
    await Linking.openURL(url);
    return "opened";
  } catch (err) {
    console.warn("sms: URL fallback failed", err);
    return "failed";
  }
}

export function snapshotBroadcast(): BroadcastSnapshot {
  const { isBroadcasting, mode } = useSharingStore.getState();
  return { wasBroadcasting: isBroadcasting, mode };
}

export async function hasBackgroundLocationPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Switches live location sharing to emergency mode. Resolves "denied" when
 * "Allow all the time" location isn't granted. Never throws.
 */
export async function startEmergencyBroadcast(): Promise<"started" | "denied" | "failed"> {
  try {
    await startLocationBroadcast("emergency");
    const sharing = useSharingStore.getState();
    sharing.setMode("emergency");
    sharing.setBroadcasting(true);
    return "started";
  } catch (err) {
    if (err instanceof BackgroundLocationDeniedError) return "denied";
    console.warn("Emergency location broadcast failed", err);
    return "failed";
  }
}

/** Returns live sharing to how it was before the SOS. Never throws. */
export async function restoreBroadcast(previous: BroadcastSnapshot | null) {
  const sharing = useSharingStore.getState();
  try {
    if (previous?.wasBroadcasting) {
      sharing.setMode(previous.mode);
      await startLocationBroadcast(previous.mode);
    } else {
      await stopLocationBroadcast();
      sharing.setBroadcasting(false);
      sharing.setMode(previous?.mode ?? "normal");
    }
  } catch (err) {
    console.warn("Failed to restore location broadcast", err);
    await stopLocationBroadcast().catch(() => {});
    sharing.setBroadcasting(false);
  }
}
