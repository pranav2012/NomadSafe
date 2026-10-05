import { Platform } from "react-native";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { usePendingJoinStore } from "@/features/trips/store/pendingJoinStore";
import { inviteCodeFromReferrer, inviteCodeFromUrl } from "@/features/trips/utils/inviteLinks";
import { track } from "@/modules/analytics";
import { backendSiteUrl } from "@/modules/backend";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";

const CHECKED_KEY = "deferred-invite-checked";

/**
 * Reads an invite URL the invite page copied before sending the user to the App Store. Checks for
 * a URL first so there's no paste prompt unless one is there.
 */
async function codeFromClipboard(): Promise<string | null> {
  if (!backendSiteUrl || !(await Clipboard.hasUrlAsync())) return null;
  const url = await Clipboard.getUrlAsync();
  return url ? inviteCodeFromUrl(url, backendSiteUrl) : null;
}

/**
 * Picks up an invite link opened before the app was installed, once per install and only before
 * onboarding. The code goes to the pending join store, which opens it once the user is in the app.
 */
export async function checkDeferredInvite() {
  if (storage.getBoolean(CHECKED_KEY)) return;
  storage.set(CHECKED_KEY, true);
  if (useSettingsStore.getState().onboardingCompleted) return;
  if (usePendingJoinStore.getState().code) return;
  try {
    const source = Platform.OS === "android" ? "install_referrer" : "clipboard";
    const code = Platform.OS === "android" ? inviteCodeFromReferrer(await Application.getInstallReferrerAsync()) : await codeFromClipboard();
    if (!code || usePendingJoinStore.getState().code) return;
    usePendingJoinStore.getState().setCode(code, true);
    track("invite_deferred_found", { source });
  } catch (error) {
    logger.warn("invites", "deferred invite check failed", error);
  }
}
