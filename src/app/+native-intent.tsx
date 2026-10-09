import { noteIncomingLink } from "@/features/expenses/services/voiceCaptureSession";
import { isIncomingFileLink, useIncomingTicketStore } from "@/features/itinerary/store/incomingTicketStore";
import { sharedTextFromLink } from "@/features/itinerary/utils/shareLink";
import { useIncomingShareStore } from "@/features/itinerary/store/incomingShareStore";
import { isQuickSosLink, useQuickSosStore } from "@/features/safety/store/quickSosStore";
import { usePendingJoinStore } from "@/features/trips/store/pendingJoinStore";
import { inviteCodeFromPath } from "@/features/trips/utils/inviteLinks";
import { isWidgetToken, linkParam, WIDGET_TOKEN_PARAM, withoutLinkParams } from "@/features/widget/widgetToken";

// Google OAuth callback (`com.pranav.nomadsafe:/oauthredirect?...`), consumed by expo-auth-session.
const OAUTH_REDIRECT = /^(?:[\w.+-]+:\/{1,2}|\/)oauthredirect(?:[/?#]|$)/;
// Google sign-in's return to the app root (`nomadsafe://?cookie=...`), consumed by Better Auth's auth session.
const SIGN_IN_CALLBACK = /^(?:[\w.+-]+:\/\/\/?|\/)?\?(?:[^#]*&)?cookie=/;

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  // Not a screen: navigating would unmount the sheet waiting for the auth result.
  if (OAUTH_REDIRECT.test(path)) return null;
  // Navigating would route through "/" back to sign-in while the session is still loading.
  if (SIGN_IN_CALLBACK.test(path)) return null;
  // A ticket sent by someone and opened with NomadSafe: the user picks which item it belongs to.
  if (isIncomingFileLink(path)) {
    useIncomingTicketStore.getState().set(path);
    return "/receive-ticket";
  }
  // A link shared from another app through the iOS Share Extension; the tabs layout opens "Save idea".
  const shared = sharedTextFromLink(path);
  if (shared !== null) {
    if (shared) useIncomingShareStore.getState().set(shared);
    return "/";
  }
  const fromWidget = isWidgetToken(linkParam(path, WIDGET_TOKEN_PARAM));
  // The SOS widget: the Safety tab starts the cancel countdown once it's on screen. The same link
  // from another app (no matching token) only opens the Safety tab.
  if (isQuickSosLink(path)) {
    if (!fromWidget) return "/sos";
    noteIncomingLink(path, true);
    useQuickSosStore.getState().request();
    return "/sos";
  }
  // Voice capture works while PIN-locked, so only our widget may start the mic straight away.
  if (path.includes("voice-expense")) {
    path = withoutLinkParams(path, fromWidget ? [WIDGET_TOKEN_PARAM] : [WIDGET_TOKEN_PARAM, "autostart", "source"]);
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
