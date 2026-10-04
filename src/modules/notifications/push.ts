import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

/** Expo push token for this install. Throws when push isn't configured for the build. */
export async function getPushToken(): Promise<string> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}
