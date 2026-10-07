import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import type { BroadcastMode } from "../utils/circle";

export type { BroadcastMode };

const HOUR_MS = 60 * 60_000;
/** How long a new share lasts before it stops itself; null shares until stopped. */
export const SHARE_DURATIONS: (number | null)[] = [HOUR_MS, 8 * HOUR_MS, 24 * HOUR_MS, null];
const DEFAULT_SHARE_DURATION = 8 * HOUR_MS;

/** UI mirror of live sharing; the circle lives in Convex and the task keeps its own state. */
export interface SharingState {
  isBroadcasting: boolean;
  mode: BroadcastMode;
  shareDuration: number | null;

  setBroadcasting: (enabled: boolean) => void;
  setMode: (mode: BroadcastMode) => void;
  setShareDuration: (duration: number | null) => void;
  reset: () => void;
}

const DEFAULT_MODE: BroadcastMode = "normal";

export const useSharingStore = create<SharingState>()(
  persist(
    (set) => ({
      isBroadcasting: false,
      mode: DEFAULT_MODE,
      shareDuration: DEFAULT_SHARE_DURATION,

      setBroadcasting: (enabled) => {
        set({ isBroadcasting: enabled });
      },

      setMode: (mode) => {
        set({ mode });
      },

      setShareDuration: (shareDuration) => {
        set({ shareDuration });
      },

      reset: () => {
        set({
          isBroadcasting: false,
          mode: DEFAULT_MODE,
          shareDuration: DEFAULT_SHARE_DURATION,
        });
      },
    }),
    {
      name: "sharing-store",
      storage: createJSONStorage(() => mmkvStateStorage),
      version: 1,
    },
  ),
);
