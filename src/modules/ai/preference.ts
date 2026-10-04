import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { AiProvider } from "./policy";

interface AiPreferenceState {
  /** The AI source the user picked for every feature; null = automatic. How it's applied is in `policy.ts`. */
  preferred: AiProvider | null;
}

export const useAiPreferenceStore = create<AiPreferenceState>()(
  persist(() => ({ preferred: null as AiProvider | null }), {
    name: "ai-preference",
    storage: createJSONStorage(() => mmkvStateStorage),
    version: 1,
  }),
);

export function setPreferredAiSource(preferred: AiProvider | null) {
  useAiPreferenceStore.setState({ preferred });
}

/** Back to automatic; on sign-out, wipe, or when the picked source is gone for good. */
export function resetAiPreference() {
  useAiPreferenceStore.setState({ preferred: null });
}
