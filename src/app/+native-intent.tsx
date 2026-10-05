import { noteIncomingLink } from "@/features/expenses/services/voiceCaptureSession";
import { isQuickSosLink, useQuickSosStore } from "@/features/safety/store/quickSosStore";
import { usePendingJoinStore } from "@/features/trips/store/pendingJoinStore";
import { inviteCodeFromPath } from "@/features/trips/utils/inviteLinks";

// Google OAuth callback (`com.pranav.nomadsafe:/oauthredirect?...`), consumed by expo-auth-session.
const OAUTH_REDIRECT = /^(?:[\w.+-]+:\/{1,2}|\/)oauthredirect(?:[/?#]|$)/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // Not a screen: navigating would unmount the sheet waiting for the auth result.
  if (OAUTH_REDIRECT.test(path)) return null;
  // The SOS widget: the Safety tab starts the cancel countdown once it's on screen.
  if (isQuickSosLink(path)) {
    noteIncomingLink(path, true);
    useQuickSosStore.getState().request();
    return "/sos";
  }
  noteIncomingLink(path);
  // Invite links wait until the user is signed in and onboarded; the tabs layout picks them up.
  const code = inviteCodeFromPath(path);
  if (code) {
    usePendingJoinStore.getState().setCode(code);
    return "/";
  }
  return path;
}
