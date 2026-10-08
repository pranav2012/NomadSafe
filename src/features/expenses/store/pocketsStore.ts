import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mmkvStateStorage } from "@/modules/storage";
import { nextRecordId } from "@/utils/recordId";
import type { ForexPocket, PocketClose, PocketLoad } from "@/features/expenses/utils/forex";

interface PocketsState {
  /** Backed up as sync kind `pocket`; never shared with trip members. */
  pockets: ForexPocket[];
  /** Trips whose "Got forex?" prompt was dismissed (this phone only). */
  dismissedPrompts: string[];
  add: (pocket: Omit<ForexPocket, "id" | "createdAt">) => ForexPocket;
  update: (id: string, patch: Partial<Omit<ForexPocket, "id">>) => void;
  addLoad: (id: string, load: Omit<PocketLoad, "id">) => void;
  removeLoad: (id: string, loadId: string) => void;
  setSpend: (expenseId: string, pocketId: string | null) => void;
  close: (id: string, closed: PocketClose) => void;
  reopen: (id: string) => void;
  remove: (id: string) => void;
  removeByGroupId: (groupId: string) => void;
  dismissPrompt: (tripId: string) => void;
  restorePrompt: (tripId: string) => void;
  reset: () => void;
}

const patchPocket = (pockets: ForexPocket[], id: string, change: (pocket: ForexPocket) => ForexPocket) =>
  pockets.map((pocket) => (pocket.id === id ? change(pocket) : pocket));

export const usePocketsStore = create<PocketsState>()(
  persist(
    (set) => ({
      pockets: [],
      dismissedPrompts: [],
      add: (input) => {
        const pocket: ForexPocket = { ...input, id: nextRecordId(), createdAt: new Date().toISOString() };
        set((state) => ({ pockets: [pocket, ...state.pockets] }));
        return pocket;
      },
      update: (id, patch) => set((state) => ({ pockets: patchPocket(state.pockets, id, (pocket) => ({ ...pocket, ...patch })) })),
      addLoad: (id, load) =>
        set((state) => ({ pockets: patchPocket(state.pockets, id, (pocket) => ({ ...pocket, loads: [...pocket.loads, { ...load, id: nextRecordId() }] })) })),
      removeLoad: (id, loadId) =>
        set((state) => ({ pockets: patchPocket(state.pockets, id, (pocket) => ({ ...pocket, loads: pocket.loads.filter((load) => load.id !== loadId) })) })),
      setSpend: (expenseId, pocketId) =>
        set((state) => {
          const current = state.pockets.find((pocket) => pocket.spendIds.includes(expenseId))?.id ?? null;
          if (current === pocketId) return state;
          return {
            pockets: state.pockets.map((pocket) => {
              if (pocket.id === current) return { ...pocket, spendIds: pocket.spendIds.filter((id) => id !== expenseId) };
              if (pocket.id === pocketId) return { ...pocket, spendIds: [...pocket.spendIds, expenseId] };
              return pocket;
            }),
          };
        }),
      close: (id, closed) => set((state) => ({ pockets: patchPocket(state.pockets, id, (pocket) => ({ ...pocket, closed })) })),
      reopen: (id) =>
        set((state) => ({
          pockets: patchPocket(state.pockets, id, (pocket) => {
            const { closed: _closed, ...rest } = pocket;
            return rest;
          }),
        })),
      remove: (id) => set((state) => ({ pockets: state.pockets.filter((pocket) => pocket.id !== id) })),
      removeByGroupId: (groupId) => set((state) => ({ pockets: state.pockets.filter((pocket) => pocket.groupId !== groupId) })),
      dismissPrompt: (tripId) =>
        set((state) => (state.dismissedPrompts.includes(tripId) ? state : { dismissedPrompts: [...state.dismissedPrompts, tripId] })),
      restorePrompt: (tripId) => set((state) => ({ dismissedPrompts: state.dismissedPrompts.filter((id) => id !== tripId) })),
      reset: () => set({ pockets: [], dismissedPrompts: [] }),
    }),
    { name: "pockets-store", storage: createJSONStorage(() => mmkvStateStorage) },
  ),
);
