import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export type NotificationData = Record<string, unknown>;

export interface LocalNotification {
  /** Stable id, so the notification can be replaced, cancelled or dismissed later. */
  id?: string;
  title: string;
  body: string;
  data?: NotificationData;
  sound?: boolean;
  /** "max" raises the Android notification priority. */
  priority?: "max";
  /** Epoch ms to deliver at; omitted delivers now. */
  at?: number;
  /** Android channel to post in. */
  channelId?: string;
}

function trigger(notification: LocalNotification): Notifications.NotificationTriggerInput {
  if (notification.at !== undefined) {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: notification.at,
      channelId: notification.channelId,
    };
  }
  return notification.channelId ? { channelId: notification.channelId } : null;
}

/** Posts a local notification now or schedules it for `at`. Resolves the notification id. */
export function schedule(notification: LocalNotification): Promise<string> {
  const { id, title, body, data, sound, priority } = notification;
  return Notifications.scheduleNotificationAsync({
    ...(id !== undefined ? { identifier: id } : {}),
    content: {
      title,
      body,
      ...(data !== undefined ? { data } : {}),
      ...(sound !== undefined ? { sound } : {}),
      ...(priority === "max" && Platform.OS === "android"
        ? { priority: Notifications.AndroidNotificationPriority.MAX }
        : {}),
    },
    trigger: trigger(notification),
  });
}

/** Cancels a scheduled notification that hasn't been delivered yet. */
export function cancel(id: string): Promise<void> {
  return Notifications.cancelScheduledNotificationAsync(id);
}

/** Removes an already delivered notification from the tray. */
export function dismiss(id: string): Promise<void> {
  return Notifications.dismissNotificationAsync(id);
}
