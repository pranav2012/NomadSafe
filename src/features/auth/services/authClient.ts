import { createAuthClient } from "better-auth/react";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const baseURL = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
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

export const authClient = createAuthClient({
  baseURL,
  plugins: [
    expoClient({
      scheme,
      storagePrefix: scheme,
      storage: SecureStore,
    }),
    convexClient(),
  ],
});
