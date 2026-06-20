import * as Location from "expo-location";
import { defineTask } from "expo-task-manager";
import { storage } from "@/stores/storage";
import { getIntervalForMode } from "../store/sharingStore";
import { getSharingToken } from "@/features/auth/services/authClient";

export const BROADCAST_TASK_NAME = "nomadsafe-location-broadcast";

interface BroadcastPersistedState {
  isBroadcasting: boolean;
  mode: "normal" | "low" | "emergency";
  lastPublishedAt: number | null;
  recipients: { id: string; sharing: boolean }[];
}

const baseURL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
const PUBLISH_PATH = "/api/sharing/publish";

function readStore(): { state: BroadcastPersistedState } | null {
  const raw = storage.getString("sharing-store");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { state: BroadcastPersistedState };
  } catch {
    return null;
  }
}

function writeStore(store: { state: BroadcastPersistedState }) {
  storage.set("sharing-store", JSON.stringify(store));
}

async function publishToConvex(
  latitude: number,
  longitude: number,
  mode: "normal" | "low" | "emergency",
  battery: number | null,
) {
  const token = getSharingToken();
  if (!token || !baseURL) {
    return { ok: false, skipped: true };
  }

  try {
    const res = await fetch(`${baseURL}${PUBLISH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        latitude,
        longitude,
        mode,
        battery,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

defineTask(BROADCAST_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locationData = data as { locations?: Location.LocationObject[] } | undefined;
  const locations = locationData?.locations;
  if (!locations || locations.length === 0) return;

  const store = readStore();
  if (!store?.state?.isBroadcasting) return;

  const last = locations[locations.length - 1];
  const now = Date.now();
  const intervalMs = getIntervalForMode(store.state.mode) * 1000;
  if (store.state.lastPublishedAt && now - store.state.lastPublishedAt < intervalMs) return;

  storage.set(
    "sharing-last-broadcast",
    JSON.stringify({
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
      timestamp: now,
      mode: store.state.mode,
    }),
  );

  // Push real location to Convex so accepted linked contacts can see it.
  await publishToConvex(
    last.coords.latitude,
    last.coords.longitude,
    store.state.mode,
    null,
  );

  store.state.lastPublishedAt = now;
  writeStore(store);
});

export async function startLocationBroadcast(mode: "normal" | "low" | "emergency") {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) throw new Error("Location permission denied");

  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) throw new Error("Background location permission denied");

  const isRegistered = await Location.hasStartedLocationUpdatesAsync(BROADCAST_TASK_NAME);
  if (isRegistered) await Location.stopLocationUpdatesAsync(BROADCAST_TASK_NAME);

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
      notificationTitle: "Nomad Safe · live location sharing",
      notificationBody: "Your trusted contacts can see your location.",
      killServiceOnDestroy: false,
    },
    pausesUpdatesAutomatically: false,
  });
}

export async function stopLocationBroadcast() {
  const isRegistered = await Location.hasStartedLocationUpdatesAsync(BROADCAST_TASK_NAME);
  if (isRegistered) {
    await Location.stopLocationUpdatesAsync(BROADCAST_TASK_NAME);
  }
}
