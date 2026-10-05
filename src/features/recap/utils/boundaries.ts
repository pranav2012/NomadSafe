import { create } from "zustand";

/** Which borders to draw: India's official view (for people in India) or Natural Earth's default. */
export type BoundaryView = "default" | "IN";

export const useBoundaryStore = create<{ view: BoundaryView; setView: (view: BoundaryView) => void }>()((set) => ({
  view: "default",
  setView: (view) => set({ view }),
}));

export const boundaryView = (): BoundaryView => useBoundaryStore.getState().view;
