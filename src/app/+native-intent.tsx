import { noteIncomingLink } from "@/features/expenses/services/voiceCaptureSession";
import { inviteCodeFromPath, usePendingJoinStore } from "@/features/trips/store/pendingJoinStore";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  noteIncomingLink(path);
  // Invite links wait until the user is signed in and onboarded; the tabs layout picks them up.
  const code = inviteCodeFromPath(path);
  if (code) {
    usePendingJoinStore.getState().setCode(code);
    return "/";
  }
  return path;
}
