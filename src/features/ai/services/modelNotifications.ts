import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { storage } from "@/stores/storage";
import { translate } from "@/localization/translate";

const NOTIFY_PREF_KEY = "ai-notify-on-download";

let handlerConfigured = false;
let permissionGranted: boolean | null = null;

function setupAndroidChannels() {
  Notifications.setNotificationChannelAsync("downloads", {
    name: translate("aiTab.notifyChannelDownloads"),
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {
    // channel setup is best-effort
  });
  Notifications.setNotificationChannelAsync("assistant", {
    name: translate("aiTab.notifyChannelAssistant"),
    importance: Notifications.AndroidImportance.DEFAULT,
  }).catch(() => {
    // channel setup is best-effort
  });
}

/**
 * Local notifications for background model downloads. We only ever post a
 * single "model ready" notification, so the surface here is intentionally thin.
 */
export const modelNotifications = {
  configure() {
    if (handlerConfigured) return;
    handlerConfigured = true;
    // The global foreground handler is owned by useSafetyNotificationRouting.
    if (Platform.OS === "android") setupAndroidChannels();
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
        title: translate("aiTab.notifyModelReadyTitle"),
        body: translate("aiTab.notifyModelReadyBody", { model: modelName }),
        ...(Platform.OS === "android" ? { channelId: "downloads" } : {}),
      },
      trigger: null,
    });
  },

  /**
   * Posts a local notification when the assistant finishes a chat reply while
   * the app is backgrounded. Reuses the same opt-in as download notifications.
   */
  async notifyAssistantReply(): Promise<void> {
    if (!this.isEnabled()) return;
    this.configure();
    const granted = await this.ensurePermission();
    if (!granted) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: translate("aiTab.notifyReplyTitle"),
        body: translate("aiTab.notifyReplyBody"),
        ...(Platform.OS === "android" ? { channelId: "assistant" } : {}),
      },
      trigger: null,
    });
  },
};
