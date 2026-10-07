import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";

interface IdeaThumbsState {
  /** Saved idea id → local image file (a frame of the reel, captured the first time it played). */
  thumbs: Record<string, string>;
  set: (eventId: string, uri: string) => void;
  remove: (eventIds: string[]) => void;
  reset: () => void;
}

/** Preview images for saved reels that have none from the web (Instagram). On this phone only; never synced. */
export const useIdeaThumbsStore = create<IdeaThumbsState>()(
  persist(
    (set) => ({
      thumbs: {},
      set: (eventId, uri) => set((state) => ({ thumbs: { ...state.thumbs, [eventId]: uri } })),
      remove: (eventIds) =>
        set((state) => ({ thumbs: Object.fromEntries(Object.entries(state.thumbs).filter(([id]) => !eventIds.includes(id))) })),
      reset: () => set({ thumbs: {} }),
    }),
    { name: "idea-thumbs", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
