import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { storage } from "@/stores/storage";

const NOTIFY_PREF_KEY = "ai-notify-on-download";

let handlerConfigured = false;
let permissionGranted: boolean | null = null;

/**
 * Local notifications for background model downloads. We only ever post a
 * single "model ready" notification, so the surface here is intentionally thin.
 */
export const modelNotifications = {
  configure() {
    if (handlerConfigured) return;
    handlerConfigured = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      Notifications.setNotificationChannelAsync("downloads", {
        name: "Downloads",
        importance: Notifications.AndroidImportance.DEFAULT,
      }).catch(() => {
        // channel setup is best-effort
      });
    }
  },

  async ensurePermission(): Promise<boolean> {
    if (permissionGranted !== null) return permissionGranted;
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted" && current.canAskAgain) {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    permissionGranted = status === "granted";
    return permissionGranted;
  },

  /** Whether the user opted in to a download-complete notification. */
  isEnabled(): boolean {
    return storage.getBoolean(NOTIFY_PREF_KEY) ?? false;
  },

  /**
   * Toggles the download-complete notification. Enabling requests permission;
   * the stored preference is only true when permission is actually granted.
   * Returns the effective enabled state.
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      storage.set(NOTIFY_PREF_KEY, false);
      return false;
    }
    this.configure();
    const granted = await this.ensurePermission();
    storage.set(NOTIFY_PREF_KEY, granted);
    return granted;
  },

  async notifyModelReady(modelName: string): Promise<void> {
    if (!this.isEnabled()) return;
    this.configure();
    const granted = await this.ensurePermission();
    if (!granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Assistant ready",
        body: `${modelName} finished downloading and is ready to use offline.`,
        ...(Platform.OS === "android" ? { channelId: "downloads" } : {}),
      },
      trigger: null,
    });
  },
};
