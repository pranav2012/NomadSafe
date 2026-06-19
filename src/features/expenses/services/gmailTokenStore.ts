import * as SecureStore from "expo-secure-store";

const KEY = "nomadsafe.gmail.tokens";

export interface StoredGmailTokens {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt?: number;
}

export async function loadGmailTokens(): Promise<StoredGmailTokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredGmailTokens) : null;
  } catch {
    return null;
  }
}

export async function saveGmailTokens(tokens: StoredGmailTokens): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(tokens));
  } catch {
    // best-effort; a failed persist just means the user reconnects next launch
  }
}

export async function clearGmailTokens(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // ignore
  }
}
