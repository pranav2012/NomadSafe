import { create } from "zustand";

interface SafetyIntentState {
  /** Set by Home's "Get home safe" card; the Safety tab opens its safe-arrival timer sheet and clears it. */
  openTimer: boolean;
  requestTimer: () => void;
  consume: () => void;
}

export const useSafetyIntentStore = create<SafetyIntentState>()((set) => ({
  openTimer: false,
  requestTimer: () => set({ openTimer: true }),
  consume: () => set({ openTimer: false }),
}));
