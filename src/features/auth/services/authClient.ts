import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import { phoneNumberClient } from "better-auth/client/plugins";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { storage } from "@/stores/storage";

const baseURL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
const scheme = Constants.expoConfig?.scheme as string | undefined;

if (!baseURL) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_SITE_URL. Add it to your .env.local file.",
  );
}

if (!scheme) {
  throw new Error("Missing Expo scheme in app.json.");
}

const SHARING_TOKEN_KEY = "nomadsafe-sharing-token";

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      scheme,
      storagePrefix: scheme,
      storage: SecureStore,
    }),
    convexClient(),
    phoneNumberClient(),
  ],
});

/**
 * Persist the active Better Auth bearer token so background tasks can
 * authenticate with Convex HTTP actions when the app is not in foreground.
 */
export async function refreshSharingToken() {
  try {
    const session = await authClient.getSession();
    const token = session.data?.session?.token ?? null;
    if (token) {
      storage.set(SHARING_TOKEN_KEY, token);
    }
    return token;
  } catch {
    return null;
  }
}

export function getSharingToken(): string | null {
  return storage.getString(SHARING_TOKEN_KEY) ?? null;
}

export function clearSharingToken() {
  storage.remove(SHARING_TOKEN_KEY);
}

export { SHARING_TOKEN_KEY };
