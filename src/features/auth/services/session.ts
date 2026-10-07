import * as LocalAuthentication from "expo-local-authentication";
import { authClient } from "@/modules/backend";
import { useAuthStore } from "@/features/auth/store/authStore";
import { loadGmailTokens } from "@/features/expenses/services/gmailTokenStore";
import { forgetGmailTokens } from "@/features/expenses/store/gmailConnectionStore";
import {
  clearBroadcastState,
  stopLocationBroadcast,
} from "@/features/location-sharing/services/locationBroadcastTask";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";
import { clearPlacesCache } from "@/features/places/services/placesCache";
import {
  clearSharedLocalData,
  clearSyncedLocalData,
  flushGroupSync,
  flushSync,
  hasBackupOwner,
  stopGroupSync,
  stopSync,
  unregisterGroupPush,
} from "@/features/sync";
import { clearServerCheckIn } from "@/features/safety/services/safetyServerAlerts";
import { clearAiUsageLog, clearByokConfig, clearCloudExhaustion, resetAiPreference } from "@/modules/ai";
import { flushPendingWrites } from "@/modules/storage";
import { withSystemPrompt } from "@/utils/systemPrompt";

/** Revokes the Google grant (best-effort) and forgets the local tokens. */
export async function disconnectGmail() {
  const tokens = await loadGmailTokens();
  const token = tokens?.refreshToken ?? tokens?.accessToken;
  if (token) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    } catch {}
  }
  await forgetGmailTokens({ lostAccess: false });
}

/**
 * Confirms the device owner before destructive actions. Uses biometrics with
 * the device PIN/pattern as fallback; devices with no screen lock at all
 * can't be challenged, so the caller's confirmation dialog is the only gate.
 */
export async function confirmDeviceOwner(promptMessage: string, cancelLabel: string) {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
    const result = await withSystemPrompt(() =>
      LocalAuthentication.authenticateAsync({
        promptMessage,
        cancelLabel,
        disableDeviceFallback: false,
      }),
    );
    return result.success;
  } catch {
    return false;
  }
}

/** Sends pending shared-trip and backup changes; false when some couldn't reach the server in time. */
export async function flushBeforeSignOut() {
  const backedUp = hasBackupOwner();
  return (await flushGroupSync()) && (!backedUp || (await flushSync()));
}

/**
 * Ends the account session: stops live location sharing (server shares are
 * marked inactive while the session is still valid), revokes Gmail access,
 * sends pending backup changes, then signs out. Backed-up trips and expenses are
 * removed from the phone; with backup off they stay unless wiped. A saved AI API key, the AI source choice and the on-phone AI usage log are forgotten.
 */
export async function signOutAndCleanup() {
  try {
    await stopLocationBroadcast();
  } catch {}
  clearBroadcastState();
  clearPlacesCache();
  useSharingStore.getState().setBroadcasting(false);

  await disconnectGmail();
  try {
    await clearByokConfig();
  } catch {}
  clearCloudExhaustion();
  resetAiPreference();
  clearAiUsageLog();
  // While the session is still valid, so contacts aren't alerted about a check-in nobody can answer.
  await clearServerCheckIn();

  // Shared trips and backed-up data live on the account, so they leave the phone with it. Both
  // engines stop before anything is cleared, or the clearing would be uploaded as deletions.
  const backedUp = hasBackupOwner();
  await flushGroupSync();
  if (backedUp) await flushSync();
  stopGroupSync();
  stopSync();
  clearSharedLocalData(useAuthStore.getState().user?.id ?? null);
  if (backedUp) clearSyncedLocalData();
  await unregisterGroupPush();

  try {
    await authClient.signOut();
  } catch {}
  useAuthStore.getState().signOut();
  flushPendingWrites();
}
