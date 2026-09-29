import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { logger } from "@/services/logger";

export const SAFETY_CHANNEL_ID = "safety-checkin-v2";
export const SAFETY_NOTIFICATION_SOURCE = "nomadsafe-safety";
export const SOS_ROUTE = "/(tabs)/sos";

const DUE_ID = "nomadsafe-checkin-due";
const WARNING_ID = "nomadsafe-checkin-warning";
const WARNING_LEAD_MS = 5 * 60 * 1000;
const MIN_WARNING_GAP_MS = 60 * 1000;

export type NotificationPermission = "granted" | "denied" | "undetermined";

export interface CheckInNotificationCopy {
  channelName: string;
  dueTitle: string;
  dueBody: string;
  warningTitle: string;
  warningBody: string;
}

export type ScheduleResult = "scheduled" | "permission-denied" | "error" | "stale";

// Bumped on every schedule/cancel so an in-flight schedule can't resurrect a cancelled check-in.
let generation = 0;

async function ensureChannel(name: string) {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(SAFETY_CHANNEL_ID, {
    name,
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 250, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/** Reads the current notification permission without prompting. */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
  } catch {
    return "undetermined";
  }
}

/** Permission status plus whether the OS will still show a prompt. */
export async function getNotificationPermissionDetails(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    return { granted: status === "granted", canAskAgain };
  } catch {
    return { granted: false, canAskAgain: false };
  }
}

/** User-initiated prompt; creates the Android channel first so the prompt can appear. */
export async function requestNotificationPermission(channelName: string): Promise<boolean> {
  try {
    await ensureChannel(channelName);
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  if (!current.canAskAgain) return false;
  const next = await Notifications.requestPermissionsAsync();
  return next.status === "granted";
}

/**
 * Schedules the "check-in due" notification at endsAt plus a pre-warning 5 min
 * earlier (when the timer is long enough). Replaces any previously scheduled pair.
 */
export async function scheduleCheckInNotifications(
  endsAt: number,
  copy: CheckInNotificationCopy,
): Promise<ScheduleResult> {
  const token = ++generation;
  try {
    await cancelScheduled();
    // Channel must exist before the Android 13+ permission prompt can appear.
    await ensureChannel(copy.channelName);
    if (!(await ensurePermission())) return "permission-denied";
    if (token !== generation) return "stale";

    const data = { source: SAFETY_NOTIFICATION_SOURCE, url: SOS_ROUTE, kind: "checkInDue" };
    const android = Platform.OS === "android"
      ? { priority: Notifications.AndroidNotificationPriority.MAX }
      : {};

    const warningAt = endsAt - WARNING_LEAD_MS;
    if (warningAt - Date.now() > MIN_WARNING_GAP_MS) {
      await Notifications.scheduleNotificationAsync({
        identifier: WARNING_ID,
        content: {
          title: copy.warningTitle,
          body: copy.warningBody,
          data: { ...data, kind: "checkInWarning" },
          sound: true,
          ...android,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: warningAt,
          channelId: SAFETY_CHANNEL_ID,
        },
      });
    }
    if (token !== generation) {
      await cancelScheduled();
      return "stale";
    }

    await Notifications.scheduleNotificationAsync({
      identifier: DUE_ID,
      content: {
        title: copy.dueTitle,
        body: copy.dueBody,
        data,
        sound: true,
        ...android,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: Math.max(endsAt, Date.now() + 1000),
        channelId: SAFETY_CHANNEL_ID,
      },
    });
    if (token !== generation) {
      await cancelScheduled();
      return "stale";
    }
    return "scheduled";
  } catch (err) {
    logger.warn("check-in", "failed to schedule notifications", err);
    return "error";
  }
}

async function cancelScheduled() {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(DUE_ID).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(WARNING_ID).catch(() => {}),
  ]);
}

/** Cancels pending check-in notifications and clears any already delivered ones. */
export async function cancelCheckInNotifications(): Promise<void> {
  generation++;
  await cancelScheduled();
  await Promise.all([
    Notifications.dismissNotificationAsync(DUE_ID).catch(() => {}),
    Notifications.dismissNotificationAsync(WARNING_ID).catch(() => {}),
  ]);
}
