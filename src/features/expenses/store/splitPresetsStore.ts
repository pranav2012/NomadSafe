import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

export interface SplitPreset {
  id: string;
  mode: "percent" | "shares";
  /** Percent or shares per person. */
  weights: Record<string, number>;
}

interface SplitPresetsState {
  /** Saved splits per trip or group (Plus), on this phone only. */
  byGroup: Record<string, SplitPreset[]>;
  add: (groupId: string, preset: Omit<SplitPreset, "id">) => void;
  remove: (groupId: string, id: string) => void;
  reset: () => void;
}

const MAX_PER_GROUP = 6;

export const useSplitPresetsStore = create<SplitPresetsState>()(
  persist(
    (set) => ({
      byGroup: {},
      add: (groupId, preset) =>
        set((state) => {
          const existing = state.byGroup[groupId] ?? [];
          const key = JSON.stringify([preset.mode, preset.weights]);
          if (existing.some((item) => JSON.stringify([item.mode, item.weights]) === key)) return state;
          const next = [{ ...preset, id: `${Date.now()}` }, ...existing].slice(0, MAX_PER_GROUP);
          return { byGroup: { ...state.byGroup, [groupId]: next } };
        }),
      remove: (groupId, id) =>
        set((state) => ({ byGroup: { ...state.byGroup, [groupId]: (state.byGroup[groupId] ?? []).filter((item) => item.id !== id) } })),
      reset: () => set({ byGroup: {} }),
    }),
    { name: "split-presets-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
