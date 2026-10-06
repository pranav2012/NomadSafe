import { create } from "zustand";

interface AiContextState {
  /** The trip, group, overview or general chat picked in the AI tab; null follows the default. */
  picked: string | null;
  pick: (id: string | null) => void;
}

export const useAiContextStore = create<AiContextState>()((set) => ({
  picked: null,
  pick: (picked) => set({ picked }),
}));
