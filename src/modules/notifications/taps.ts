import * as Notifications from "expo-notifications";
import type { NotificationData } from "./local";

export interface ForegroundPresentation {
  showBanner: boolean;
  showList: boolean;
  playSound: boolean;
  setBadge: boolean;
}

/** Sets the single app-wide rule for how notifications show while the app is in the foreground. */
export function setForegroundHandler(present: (data: NotificationData | undefined) => ForegroundPresentation) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const { showBanner, showList, playSound, setBadge } = present(notification.request.content.data);
      return { shouldShowBanner: showBanner, shouldShowList: showList, shouldPlaySound: playSound, shouldSetBadge: setBadge };
    },
  });
}

/**
 * Data of the notification the user last tapped (including the one that cold-started the app):
 * undefined while loading, null when there is none.
 */
export function useLastNotificationTap(): NotificationData | null | undefined {
  const response = Notifications.useLastNotificationResponse();
  if (response === undefined) return undefined;
  return response ? response.notification.request.content.data ?? null : null;
}

/** Forgets the last tap so it isn't handled again. */
export function clearLastNotificationTap() {
  Notifications.clearLastNotificationResponse();
}
