/** Public API of the notifications module: permissions, Android channels, local notifications, push tokens and taps. */
import { setChannel } from "./channels";
import { cancel, dismiss, schedule } from "./local";
import { getPermission, requestPermission } from "./permissions";
import { getPushToken } from "./push";
import { clearLastNotificationTap, setForegroundHandler } from "./taps";

export const notifications = {
  getPermission,
  requestPermission,
  setChannel,
  schedule,
  cancel,
  dismiss,
  getPushToken,
  setForegroundHandler,
  clearLastTap: clearLastNotificationTap,
};

export { useLastNotificationTap, type ForegroundPresentation } from "./taps";
export type { NotificationChannel } from "./channels";
export type { LocalNotification, NotificationData } from "./local";
export type { NotificationPermission, NotificationPermissionStatus } from "./permissions";
