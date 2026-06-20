import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import * as Google from "expo-auth-session/providers/google";
import {
  GMAIL_CLIENT_IDS,
  GMAIL_SCOPES,
  fetchTransactionEmails,
  isGmailConfigured,
} from "@/features/expenses/services/gmailImport";
import {
  loadGmailTokens,
  saveGmailTokens,
  type StoredGmailTokens,
} from "@/features/expenses/services/gmailTokenStore";
import {
  loadGmailLastSyncAt,
  saveGmailLastSyncAt,
} from "@/features/expenses/services/gmailSyncStore";
import type { RawMessage } from "@/features/expenses/services/transactionParser";

WebBrowser.maybeCompleteAuthSession();

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  revocationEndpoint: "https://oauth2.googleapis.com/revoke",
};

// Renew a little early so a fetch never races the expiry boundary.
const EXPIRY_SKEW_MS = 60_000;

function platformClientId(): string | undefined {
  if (Platform.OS === "ios") return GMAIL_CLIENT_IDS.ios ?? GMAIL_CLIENT_IDS.web;
  if (Platform.OS === "android") return GMAIL_CLIENT_IDS.android ?? GMAIL_CLIENT_IDS.web;
  return GMAIL_CLIENT_IDS.web;
}

function toStored(token: AuthSession.TokenResponse): StoredGmailTokens {
  const expiresAt =
    token.issuedAt && token.expiresIn
      ? (token.issuedAt + token.expiresIn) * 1000
      : undefined;
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt,
  };
}

export interface GmailImport {
  configured: boolean;
  ready: boolean;
  connected: boolean;
  connect: () => Promise<void>;
  fetchEmails: () => Promise<RawMessage[]>;
  /** Fetches emails after `since` without touching the expense sync checkpoint,
   *  so other consumers (e.g. itinerary) can keep an independent checkpoint. */
  fetchEmailsSince: (since: number | null) => Promise<RawMessage[]>;
  completeSync: () => Promise<void>;
}

export function useGmailImport(): GmailImport {
  const configured = isGmailConfigured();
  const clientId = platformClientId();
  const [tokens, setTokens] = useState<StoredGmailTokens | null>(null);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GMAIL_CLIENT_IDS.ios,
    androidClientId: GMAIL_CLIENT_IDS.android,
    webClientId: GMAIL_CLIENT_IDS.web,
    scopes: GMAIL_SCOPES,
    // `offline` requests a refresh token; `consent` forces Google to re-issue
    // one even if the user previously granted access, so the connection can
    // survive app restarts.
    extraParams: { access_type: "offline", prompt: "consent" },
  });

  // Restore a previously saved connection on mount.
  useEffect(() => {
    let mounted = true;
    loadGmailTokens().then((saved) => {
      if (mounted && saved) setTokens(saved);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Capture and persist tokens after a successful sign-in.
  useEffect(() => {
    if (response?.type === "success" && response.authentication) {
      const next = toStored(response.authentication);
      // Google omits the refresh token on re-consent; keep the one we have.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTokens((current) => {
        const merged = { ...next, refreshToken: next.refreshToken ?? current?.refreshToken };
        void saveGmailTokens(merged);
        return merged;
      });
    }
  }, [response]);

  const getValidAccessToken = useCallback(async (): Promise<string | null> => {
    const current = tokens ?? (await loadGmailTokens());
    if (!current) return null;

    const stillValid =
      current.accessToken &&
      current.expiresAt &&
      current.expiresAt - EXPIRY_SKEW_MS > Date.now();
    if (stillValid) return current.accessToken ?? null;

    if (current.refreshToken && clientId) {
      try {
        const refreshed = await AuthSession.refreshAsync(
          { clientId, refreshToken: current.refreshToken, scopes: GMAIL_SCOPES },
          discovery,
        );
        const next = toStored(refreshed);
        const merged = { ...next, refreshToken: next.refreshToken ?? current.refreshToken };
        setTokens(merged);
        await saveGmailTokens(merged);
        return merged.accessToken ?? null;
      } catch {
        return current.accessToken ?? null;
      }
    }

    return current.accessToken ?? null;
  }, [tokens, clientId]);

  const connect = useCallback(async () => {
    if (!configured) return;
    await promptAsync();
  }, [configured, promptAsync]);

  const fetchEmailsSince = useCallback(
    async (since: number | null) => {
      const token = await getValidAccessToken();
      if (!token) {
        throw new Error("Gmail is not connected.");
      }
      return fetchTransactionEmails(token, since);
    },
    [getValidAccessToken],
  );

  const fetchEmails = useCallback(
    async () => fetchEmailsSince(await loadGmailLastSyncAt()),
    [fetchEmailsSince],
  );

  const completeSync = useCallback(async () => {
    await saveGmailLastSyncAt(Date.now());
  }, []);

  // A refresh token lets us mint access tokens indefinitely; a bare access token
  // (web implicit flow) counts as connected too — an expired one surfaces at
  // fetch time as a reconnect prompt.
  const connected = Boolean(tokens?.refreshToken || tokens?.accessToken);

  return {
    configured,
    ready: Boolean(request),
    connected,
    connect,
    fetchEmails,
    fetchEmailsSince,
    completeSync,
  };
}
