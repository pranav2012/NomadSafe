import { create } from "zustand";
import {
  clearGmailTokens,
  loadGmailTokens,
  saveGmailTokens,
  type StoredGmailTokens,
} from "@/features/expenses/services/gmailTokenStore";
import { clearTripGmailCoverage } from "@/features/expenses/store/tripGmailCoverageStore";

interface GmailConnectionState {
  hydrated: boolean;
  tokens: StoredGmailTokens | null;
  /** Set when a sync finds the grant expired or revoked, so the Money screen can prompt a reconnect. */
  lostAccess: boolean;
}

export const useGmailConnectionStore = create<GmailConnectionState>()(() => ({
  hydrated: false,
  tokens: null,
  lostAccess: false,
}));

export function hasGmailGrant(tokens: StoredGmailTokens | null): boolean {
  return Boolean(tokens?.refreshToken || tokens?.accessToken);
}

let hydration: Promise<void> | null = null;

export function hydrateGmailConnection(): Promise<void> {
  hydration ??= loadGmailTokens().then((tokens) => {
    // A connect or disconnect that finished first already has the newer state.
    if (!useGmailConnectionStore.getState().hydrated) {
      useGmailConnectionStore.setState({ tokens, hydrated: true });
    }
  });
  return hydration;
}

export async function storeGmailTokens(tokens: StoredGmailTokens): Promise<void> {
  useGmailConnectionStore.setState({ tokens, hydrated: true, lostAccess: false });
  await saveGmailTokens(tokens);
}

export async function forgetGmailTokens(options: { lostAccess: boolean }): Promise<void> {
  // An expired grant keeps coverage for the reconnect; a deliberate disconnect forgets it.
  if (!options.lostAccess) clearTripGmailCoverage();
  useGmailConnectionStore.setState({ tokens: null, hydrated: true, lostAccess: options.lostAccess });
  await clearGmailTokens();
}

export function dismissGmailLostAccess(): void {
  useGmailConnectionStore.setState({ lostAccess: false });
}
