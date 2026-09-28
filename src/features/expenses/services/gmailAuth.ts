import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import {
  GMAIL_CLIENT_IDS,
  GMAIL_SCOPES,
  fetchGmailAccountEmail,
} from "@/features/expenses/services/gmailImport";
import { ImportError } from "@/features/expenses/services/importErrors";
import type { StoredGmailTokens } from "@/features/expenses/services/gmailTokenStore";
import {
  forgetGmailTokens,
  hydrateGmailConnection,
  storeGmailTokens,
  useGmailConnectionStore,
} from "@/features/expenses/store/gmailConnectionStore";

export const GMAIL_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// Renew a little early so a fetch never races the expiry boundary.
const EXPIRY_SKEW_MS = 60_000;

export function gmailClientId(): string | undefined {
  if (Platform.OS === "ios") return GMAIL_CLIENT_IDS.ios ?? GMAIL_CLIENT_IDS.web;
  if (Platform.OS === "android") return GMAIL_CLIENT_IDS.android ?? GMAIL_CLIENT_IDS.web;
  return GMAIL_CLIENT_IDS.web;
}

/** Converts a token response, keeping the refresh token Google omits on re-consent. */
export function toStoredTokens(
  token: AuthSession.TokenResponse,
  previous: StoredGmailTokens | null,
): StoredGmailTokens {
  const expiresAt =
    token.issuedAt && token.expiresIn ? (token.issuedAt + token.expiresIn) * 1000 : undefined;
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? previous?.refreshToken,
    expiresAt,
    email: previous?.email,
  };
}

async function refreshAccessToken(current: StoredGmailTokens, clientId: string): Promise<string> {
  let refreshed: AuthSession.TokenResponse;
  try {
    refreshed = await AuthSession.refreshAsync(
      { clientId, refreshToken: current.refreshToken, scopes: GMAIL_SCOPES },
      GMAIL_DISCOVERY,
    );
  } catch (error) {
    if (error instanceof AuthSession.TokenError && error.code === "invalid_grant") {
      await forgetGmailTokens({ lostAccess: true });
      throw new ImportError("gmail-auth", error.message);
    }
    throw new ImportError(error instanceof TypeError ? "network" : "gmail-api", String(error));
  }

  const next = toStoredTokens(refreshed, current);
  // Skip the save if the user disconnected or reconnected while this was in flight.
  if (useGmailConnectionStore.getState().tokens?.refreshToken === current.refreshToken) {
    await storeGmailTokens(next);
  }
  if (!next.accessToken) throw new ImportError("gmail-auth");
  return next.accessToken;
}

let refreshing: Promise<string> | null = null;

/**
 * Returns a usable access token, refreshing it when it's about to expire.
 * Concurrent callers share one refresh. `force` renews even an unexpired token,
 * used after the API rejects it.
 */
export async function getGmailAccessToken(options: { force?: boolean } = {}): Promise<string> {
  await hydrateGmailConnection();
  const current = useGmailConnectionStore.getState().tokens;
  if (!current?.accessToken && !current?.refreshToken) {
    throw new ImportError("gmail-not-connected");
  }

  const stillValid =
    current.accessToken &&
    current.expiresAt &&
    current.expiresAt - EXPIRY_SKEW_MS > Date.now();
  if (stillValid && !options.force) return current.accessToken!;

  const clientId = gmailClientId();
  // Without a refresh token (web implicit flow) the API decides; a 401 ends the grant.
  if (!current.refreshToken || !clientId) {
    if (current.accessToken && !options.force) return current.accessToken;
    await forgetGmailTokens({ lostAccess: true });
    throw new ImportError("gmail-auth");
  }

  refreshing ??= refreshAccessToken(current, clientId).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Runs a Gmail call with a valid token. On an auth rejection it renews the
 * token once and retries; if that still fails, the dead grant is cleared so
 * every screen falls back to "Connect".
 */
export async function withGmailAccess<T>(task: (accessToken: string) => Promise<T>): Promise<T> {
  try {
    return await task(await getGmailAccessToken());
  } catch (error) {
    if (!(error instanceof ImportError) || error.code !== "gmail-auth") throw error;
    if (!useGmailConnectionStore.getState().tokens) throw error;
    try {
      return await task(await getGmailAccessToken({ force: true }));
    } catch (retryError) {
      if (retryError instanceof ImportError && retryError.code === "gmail-auth") {
        await forgetGmailTokens({ lostAccess: true });
      }
      throw retryError;
    }
  }
}

let lookingUpEmail = false;

/** Fills in the connected mailbox address once, for connections saved before it was stored. */
export async function ensureGmailAccountEmail(): Promise<void> {
  const tokens = useGmailConnectionStore.getState().tokens;
  if (lookingUpEmail || !tokens || tokens.email) return;
  lookingUpEmail = true;
  try {
    const email = await withGmailAccess(fetchGmailAccountEmail);
    const latest = useGmailConnectionStore.getState().tokens;
    if (email && latest && latest.refreshToken === tokens.refreshToken) {
      await storeGmailTokens({ ...latest, email });
    }
  } catch {
  } finally {
    lookingUpEmail = false;
  }
}
