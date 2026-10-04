import { useCallback, useEffect } from "react";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { GMAIL_CLIENT_IDS, GMAIL_SCOPES, isGmailConfigured } from "@/features/expenses/services/gmailImport";
import { ensureGmailAccountEmail, toStoredTokens } from "@/features/expenses/services/gmailAuth";
import {
  hasGmailGrant,
  hydrateGmailConnection,
  storeGmailTokens,
  useGmailConnectionStore,
} from "@/features/expenses/store/gmailConnectionStore";
import { useAuthStore } from "@/features/auth/store/authStore";

WebBrowser.maybeCompleteAuthSession();

export interface GmailImport {
  configured: boolean;
  ready: boolean;
  connected: boolean;
  accountEmail: string | null;
  connect: () => Promise<void>;
}

export function useGmailImport(): GmailImport {
  const configured = isGmailConfigured();
  const tokens = useGmailConnectionStore((state) => state.tokens);
  const accountEmail = useAuthStore((state) => state.user?.email);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GMAIL_CLIENT_IDS.ios,
    androidClientId: GMAIL_CLIENT_IDS.android,
    webClientId: GMAIL_CLIENT_IDS.web,
    scopes: GMAIL_SCOPES,
    // Pre-selects the signed-in Google account; the user can still pick another.
    loginHint: accountEmail,
    // `offline` requests a refresh token; `consent` forces Google to re-issue
    // one even if the user previously granted access, so the connection can
    // survive app restarts.
    extraParams: { access_type: "offline", prompt: "consent" },
  });

  useEffect(() => {
    void hydrateGmailConnection().then(ensureGmailAccountEmail);
  }, []);

  useEffect(() => {
    if (response?.type !== "success" || !response.authentication) return;
    const current = useGmailConnectionStore.getState().tokens;
    // The user may have picked a different account, so drop the old address.
    const next = toStoredTokens(response.authentication, current && { refreshToken: current.refreshToken });
    void storeGmailTokens(next).then(ensureGmailAccountEmail);
  }, [response]);

  const connect = useCallback(async () => {
    if (!configured) return;
    await promptAsync();
  }, [configured, promptAsync]);

  return {
    configured,
    ready: Boolean(request),
    connected: hasGmailGrant(tokens),
    accountEmail: tokens?.email ?? null,
    connect,
  };
}
