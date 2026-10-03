export const VOICE_CAPTURE_ROUTE = "/voice-expense";
const LINK_GRACE_MS = 5_000;

let captureLinkAt = 0;

/** Called for incoming deep links so the auto-lock doesn't dismiss a capture screen that is still opening. */
export function noteIncomingLink(path: string) {
  if (path.includes("voice-expense")) captureLinkAt = Date.now();
}

export function isCaptureLinkRecent(): boolean {
  return Date.now() - captureLinkAt < LINK_GRACE_MS;
}

export function isVoiceCaptureRoute(pathname: string): boolean {
  return pathname.startsWith(VOICE_CAPTURE_ROUTE);
}
