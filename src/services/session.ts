import * as LocalAuthentication from "expo-local-authentication";
import { authClient } from "@/features/auth/services/authClient";
import { useAuthStore } from "@/features/auth/store/authStore";
import {
  clearGmailTokens,
  loadGmailTokens,
} from "@/features/expenses/services/gmailTokenStore";
import {
  clearBroadcastState,
  stopLocationBroadcast,
} from "@/features/location-sharing/services/locationBroadcastTask";
import { useSharingStore } from "@/features/location-sharing/store/sharingStore";

export async function isGmailConnected() {
  const tokens = await loadGmailTokens();
  return !!(tokens?.refreshToken || tokens?.accessToken);
}

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
  await clearGmailTokens();
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
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel,
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Ends the account session: stops live location sharing (server shares are
 * marked inactive while the session is still valid), revokes Gmail access,
 * then signs out. On-device trips/expenses stay unless wiped.
 */
export async function signOutAndCleanup() {
  try {
    await stopLocationBroadcast();
  } catch {}
  clearBroadcastState();
  useSharingStore.getState().setBroadcasting(false);

  await disconnectGmail();

  try {
    await authClient.signOut();
  } catch {}
  useAuthStore.getState().signOut();
}
