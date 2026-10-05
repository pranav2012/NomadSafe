import * as Notifications from "expo-notifications";
import { withSystemPrompt } from "@/utils/systemPrompt";

export type NotificationPermissionStatus = "granted" | "denied" | "undetermined";

export interface NotificationPermission {
  status: NotificationPermissionStatus;
  granted: boolean;
  /** Whether the OS will still show a prompt. */
  canAskAgain: boolean;
}

function toPermission(raw: Notifications.NotificationPermissionsStatus): NotificationPermission {
  return { status: raw.status as NotificationPermissionStatus, granted: raw.granted, canAskAgain: raw.canAskAgain };
}

/** Current permission, without prompting. Throws if the OS call fails. */
export async function getPermission(): Promise<NotificationPermission> {
  return toPermission(await Notifications.getPermissionsAsync());
}

/** Shows the OS prompt (on Android 13+ a notification channel must exist first). Throws if the OS call fails. */
export async function requestPermission(): Promise<NotificationPermission> {
  return toPermission(await withSystemPrompt(() => Notifications.requestPermissionsAsync()));
}
