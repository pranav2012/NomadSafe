import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export interface NotificationChannel {
  name: string;
  importance: "default" | "max";
  vibrationPattern?: number[];
  /** "public" shows the full notification on the lock screen. */
  lockscreenVisibility?: "public";
}

const IMPORTANCE = {
  default: Notifications.AndroidImportance.DEFAULT,
  max: Notifications.AndroidImportance.MAX,
} as const;

/** Creates or updates an Android notification channel; resolves without doing anything on iOS. */
export async function setChannel(id: string, channel: NotificationChannel): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(id, {
    name: channel.name,
    importance: IMPORTANCE[channel.importance],
    ...(channel.vibrationPattern ? { vibrationPattern: channel.vibrationPattern } : {}),
    ...(channel.lockscreenVisibility === "public"
      ? { lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC }
      : {}),
  });
}
