import { noteIncomingLink } from "@/features/expenses/services/voiceCaptureSession";

export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  noteIncomingLink(path);
  return path;
}
