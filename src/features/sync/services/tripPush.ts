import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "@convex/_generated/api";
import { getCurrentLocale, translate } from "@/localization/translate";
import { convex } from "@/services/convex";
import { logger } from "@/services/logger";
import { storage } from "@/stores/storage";

/** Must match `SOURCE` and `CHANNEL_ID` in convex/tripNotifications.ts. */
export const TRIP_NOTIFICATION_SOURCE = "nomadsafe-trip";
const CHANNEL_ID = "trip-updates";
const TOKEN_KEY = "trip-push-token";
const UNREGISTER_TIMEOUT_MS = 8_000;

/**
 * Registers this device for shared-trip notifications. Only prompts for permission when `ask`
 * (sharing or joining a trip); otherwise refreshes the token if permission was already granted.
 */
export async function registerTripPush(ask: boolean): Promise<void> {
  if (!Device.isDevice) return;
  try {
    let { granted } = await Notifications.getPermissionsAsync();
    if (!granted && ask) ({ granted } = await Notifications.requestPermissionsAsync());
    if (!granted) return;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: translate("groupTrip.channelName"),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    storage.set(TOKEN_KEY, token);
    await convex.mutation(api.tripNotifications.savePushToken, { token, locale: getCurrentLocale() });
  } catch (err) {
    // Push isn't configured in every build (iOS without IOS_PUSH_ENABLED, missing FCM credentials);
    // live sync still works. iOS failing is expected until push is enabled, so don't report it.
    if (Platform.OS !== "ios") logger.warn("trip-push", "registration failed", err);
  }
}

/** Stops this device getting the account's trip notifications (sign-out). */
export async function unregisterTripPush(): Promise<void> {
  const token = storage.getString(TOKEN_KEY);
  if (!token) return;
  storage.remove(TOKEN_KEY);
  try {
    // Convex queues calls while offline instead of failing, so give up after a while.
    const removed = await Promise.race([
      convex.mutation(api.tripNotifications.removePushToken, { token }).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), UNREGISTER_TIMEOUT_MS)),
    ]);
    if (!removed) logger.warn("trip-push", "unregister timed out");
  } catch (err) {
    logger.warn("trip-push", "unregister failed", err);
  }
}
