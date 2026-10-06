import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import * as Battery from "expo-battery";
import { useFocusEffect } from "expo-router";
import {
  getNotificationPermissionDetails,
  requestNotificationPermission,
} from "../services/checkInNotifications";
import {
  getBackgroundPermission,
  getForegroundPermission,
  requestBackgroundPermission,
  requestForegroundPermission,
} from "@/modules/location";
import { logger } from "@/modules/logger";

export type PermissionReadiness = "granted" | "askable" | "blocked";

export interface SafetyReadiness {
  loaded: boolean;
  foreground: PermissionReadiness;
  background: PermissionReadiness;
  notifications: PermissionReadiness;
  batteryOptimized: boolean | null;
}

function toReadiness(granted: boolean, canAskAgain: boolean): PermissionReadiness {
  if (granted) return "granted";
  return canAskAgain ? "askable" : "blocked";
}

async function readBatteryOptimized(): Promise<boolean | null> {
  if (Platform.OS !== "android") return null;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return null;
  }
}

async function readReadiness(): Promise<SafetyReadiness> {
  const [foreground, background, notifications, batteryOptimized] = await Promise.all([
    getForegroundPermission().catch(() => null),
    getBackgroundPermission().catch(() => null),
    getNotificationPermissionDetails(),
    readBatteryOptimized(),
  ]);
  return {
    loaded: true,
    foreground: toReadiness(!!foreground?.granted, foreground?.canAskAgain ?? true),
    background: toReadiness(!!background?.granted, background?.canAskAgain ?? true),
    notifications: toReadiness(notifications.granted, notifications.canAskAgain),
    batteryOptimized,
  };
}

/** How many settings still need fixing (battery counts on Android only); 0 until loaded. */
export function countReadinessIssues(r: SafetyReadiness) {
  if (!r.loaded) return 0;
  return [
    r.foreground !== "granted",
    r.background !== "granted",
    r.notifications !== "granted",
    r.batteryOptimized === true,
  ].filter(Boolean).length;
}

/**
 * Live safety-readiness statuses, refreshed on screen focus and whenever the
 * app returns to the foreground (users often fix things in system settings).
 */
export function useSafetyReadiness(notificationChannelName: string) {
  const [readiness, setReadiness] = useState<SafetyReadiness>(() => ({
    loaded: false,
    foreground: "askable",
    background: "askable",
    notifications: "askable",
    batteryOptimized: null,
  }));
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const next = await readReadiness();
    if (mountedRef.current) setReadiness(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      mountedRef.current = false;
      sub.remove();
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const fixForeground = useCallback(async () => {
    const current = await getForegroundPermission().catch(() => null);
    if (current && !current.granted && !current.canAskAgain) {
      await Linking.openSettings();
    } else {
      await requestForegroundPermission().catch(() => null);
    }
    await refresh();
  }, [refresh]);

  // Call only after the user accepted BackgroundLocationDisclosure.
  const requestBackground = useCallback(async () => {
    try {
      const foreground = await requestForegroundPermission();
      if (foreground.granted) {
        const background = await requestBackgroundPermission();
        if (!background.granted && !background.canAskAgain) await Linking.openSettings();
      } else if (!foreground.canAskAgain) {
        await Linking.openSettings();
      }
    } catch (err) {
      logger.warn("safety", "background location request failed", err);
    }
    await refresh();
  }, [refresh]);

  const fixNotifications = useCallback(async () => {
    const current = await getNotificationPermissionDetails();
    if (!current.granted && current.canAskAgain) {
      await requestNotificationPermission(notificationChannelName);
    } else {
      await Linking.openSettings();
    }
    await refresh();
  }, [notificationChannelName, refresh]);

  const openBatterySettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  return { readiness, refresh, fixForeground, requestBackground, fixNotifications, openBatterySettings };
}
