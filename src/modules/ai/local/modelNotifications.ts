import { Platform } from "react-native";
import { notifications } from "@/modules/notifications";
import { storage } from "@/modules/storage";
import { translate } from "@/localization/translate";

const NOTIFY_PREF_KEY = "ai-notify-on-download";
const DOWNLOADS_CHANNEL_ID = "downloads";
const ASSISTANT_CHANNEL_ID = "assistant";

let handlerConfigured = false;
let permissionGranted: boolean | null = null;
let channelsReady: Promise<unknown> = Promise.resolve();

/** Creates both channels; best-effort, so the returned promise never rejects. */
function setupAndroidChannels() {
  return Promise.all([
    notifications
      .setChannel(DOWNLOADS_CHANNEL_ID, { name: translate("aiTab.notifyChannelDownloads"), importance: "default" })
      .catch(() => {}),
    notifications
      .setChannel(ASSISTANT_CHANNEL_ID, { name: translate("aiTab.notifyChannelAssistant"), importance: "default" })
      .catch(() => {}),
  ]);
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
    if (Platform.OS === "android") channelsReady = setupAndroidChannels();
  },

  async ensurePermission(): Promise<boolean> {
    if (permissionGranted !== null) return permissionGranted;
    const current = await notifications.getPermission();
    let status = current.status;
    if (status !== "granted" && current.canAskAgain) {
      status = (await notifications.requestPermission()).status;
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
    await channelsReady;
    await notifications.schedule({
      title: translate("aiTab.notifyModelReadyTitle"),
      body: translate("aiTab.notifyModelReadyBody", { model: modelName }),
      channelId: DOWNLOADS_CHANNEL_ID,
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
    await channelsReady;
    await notifications.schedule({
      title: translate("aiTab.notifyReplyTitle"),
      body: translate("aiTab.notifyReplyBody"),
      channelId: ASSISTANT_CHANNEL_ID,
    });
  },
};
