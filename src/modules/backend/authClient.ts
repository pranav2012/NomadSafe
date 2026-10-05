import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import Constants from "expo-constants";
import { isStoragePersistent, secureStore, storage } from "@/modules/storage";
import { backendSiteUrl as baseURL } from "./client";

// The first scheme is the app's own; the others exist only for OAuth redirects.
const configScheme = Constants.expoConfig?.scheme;
const scheme = Array.isArray(configScheme) ? configScheme[0] : configScheme;

if (!baseURL) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_SITE_URL. Add it to your .env.local file.",
  );
}

if (!scheme) {
  throw new Error("Missing Expo scheme in app.json.");
}

// Background location publishing exchanges the session cookie for a JWT while the phone may be locked.
const authStorage = {
  getItem: (key: string) => secureStore.getItem(key, { background: true }),
  setItem: (key: string, value: string) => secureStore.setItem(key, value, { background: true }),
};

const KEYCHAIN_CLASS_FLAG = "auth.keychain-class";
const KEYCHAIN_CLASS_VERSION = "after-first-unlock-this-device";

/** Re-saves session items written before they were readable while locked (iOS). Runs once per install. */
async function upgradeAuthKeychainClass() {
  if (!isStoragePersistent || storage.getString(KEYCHAIN_CLASS_FLAG) === KEYCHAIN_CLASS_VERSION) return;
  const bases = [`${scheme}_cookie`, `${scheme}_session_data`];
  const keys = bases.flatMap((base) => [base, ...Array.from({ length: 8 }, (_, i) => `${base}.${i}`)]);
  const failed = await secureStore.upgradeAccessibility(keys, { background: true });
  if (failed.length === 0) storage.set(KEYCHAIN_CLASS_FLAG, KEYCHAIN_CLASS_VERSION);
}

void upgradeAuthKeychainClass();

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      scheme,
      storagePrefix: scheme,
      storage: authStorage,
    }),
    convexClient(),
  ],
});
