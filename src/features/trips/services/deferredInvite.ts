import { Platform } from "react-native";
import * as Application from "expo-application";
import * as Clipboard from "expo-clipboard";
import { INVITE_SITE_URLS } from "@/constants/legal";
import { useSettingsStore } from "@/features/settings/store/settingsStore";
import { usePendingJoinStore } from "@/features/trips/store/pendingJoinStore";
import { inviteFromReferrer, inviteFromUrl, type InviteLink } from "@/features/trips/utils/inviteLinks";
import { track } from "@/modules/analytics";
import { logger } from "@/modules/logger";
import { storage } from "@/modules/storage";

const CHECKED_KEY = "deferred-invite-checked";

/**
 * Reads an invite URL the invite page copied before sending the user to the App Store. Checks for
 * a URL first so there's no paste prompt unless one is there.
 */
async function inviteFromClipboard(): Promise<InviteLink | null> {
  if (INVITE_SITE_URLS.length === 0 || !(await Clipboard.hasUrlAsync())) return null;
  const url = await Clipboard.getUrlAsync();
  return url ? inviteFromUrl(url, INVITE_SITE_URLS) : null;
}

/**
 * Picks up an invite link opened before the app was installed, once per install and only before
 * onboarding. The invite goes to the pending join store, which opens it once the user is in the app.
 */
export async function checkDeferredInvite() {
  if (storage.getBoolean(CHECKED_KEY)) return;
  storage.set(CHECKED_KEY, true);
  if (useSettingsStore.getState().onboardingCompleted) return;
  if (usePendingJoinStore.getState().invite) return;
  try {
    const source = Platform.OS === "android" ? "install_referrer" : "clipboard";
    const invite = Platform.OS === "android" ? inviteFromReferrer(await Application.getInstallReferrerAsync()) : await inviteFromClipboard();
    if (!invite || usePendingJoinStore.getState().invite) return;
    usePendingJoinStore.getState().setInvite(invite, true);
    track("invite_deferred_found", { source, kind: invite.kind });
  } catch (error) {
    logger.warn("invites", "deferred invite check failed", error);
  }
}
