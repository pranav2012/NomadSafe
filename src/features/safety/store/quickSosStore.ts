import { create } from "zustand";

export const QUICK_SOS_URL = "nomadsafe://sos?trigger=widget";
const QUICK_SOS_LINK = /(^|\/)sos\?(.*&)?trigger=/;
// A request older than this (e.g. made before sign-in finished) is ignored rather than arming later.
const REQUEST_TTL_MS = 30_000;

interface QuickSosState {
  requestedAt: number | null;
  /** The SOS cancel countdown is on screen; it stays reachable while the app is PIN-locked. */
  arming: boolean;
  request: () => void;
  consume: () => boolean;
  setArming: (arming: boolean) => void;
}

/** One-tap SOS from a widget: the link records a request and the Safety tab starts the countdown. */
export const useQuickSosStore = create<QuickSosState>()((set, get) => ({
  requestedAt: null,
  arming: false,
  request: () => set({ requestedAt: Date.now() }),
  consume: () => {
    const { requestedAt } = get();
    set({ requestedAt: null });
    return requestedAt !== null && Date.now() - requestedAt < REQUEST_TTL_MS;
  },
  setArming: (arming) => set({ arming }),
}));

export function isQuickSosLink(path: string) {
  return QUICK_SOS_LINK.test(path);
}

export function isSosRoute(pathname: string) {
  return pathname === "/sos";
}
