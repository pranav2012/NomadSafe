import { create } from "zustand";
import { showToast } from "@/atoms";
import { track } from "@/modules/analytics";
import { ideasOf } from "@/features/itinerary/utils/ideas";
import { useEventsStore } from "./eventsStore";

export type SavedTab = "ideas" | "popular";
type OpenedFrom = "prep" | "must_dos" | "day" | "header" | "toast" | "join" | "push";

interface SavedSheetState {
  open: { tripId: string; tab: SavedTab } | null;
  show: (tripId: string, tab: SavedTab, from: OpenedFrom) => void;
  setTab: (tab: SavedTab) => void;
  /** Shown as a toast once the sheet closes; toasts drawn while it's open sit under it on Android. */
  confirmOnClose: string | null;
  setConfirmOnClose: (message: string | null) => void;
  close: () => void;
}

/** Which trip's Saved sheet is open (one sheet, mounted on Home), so rows, buttons and toasts anywhere can open it. */
export const useSavedSheetStore = create<SavedSheetState>((set, get) => ({
  open: null,
  show: (tripId, tab, from) => {
    const ideas = ideasOf(useEventsStore.getState().events.filter((event) => event.tripId === tripId)).length;
    track("saved_ideas_opened", { from, ideas });
    set({ open: { tripId, tab }, confirmOnClose: null });
  },
  setTab: (tab) => set((state) => (state.open ? { open: { ...state.open, tab } } : state)),
  confirmOnClose: null,
  setConfirmOnClose: (message) => set({ confirmOnClose: message }),
  close: () => {
    const message = get().confirmOnClose;
    set({ open: null, confirmOnClose: null });
    if (message) showToast(message);
  },
}));
