import { create } from "zustand";

interface IncomingTicketState {
  /** A file another app opened with NomadSafe, waiting for the user to pick its item. Not persisted. */
  uri: string | null;
  set: (uri: string | null) => void;
}

export const useIncomingTicketStore = create<IncomingTicketState>()((set) => ({
  uri: null,
  set: (uri) => set({ uri }),
}));

/** "Open with NomadSafe" hands over a content:// (Android) or file:// (iOS) link instead of a deep link. */
export const isIncomingFileLink = (path: string) => /^(content|file):\/\//i.test(path);
