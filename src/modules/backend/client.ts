import { ConvexReactClient } from "convex/react";
import { ConvexHttpClient } from "convex/browser";

const envUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!envUrl) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_URL. Add it to your .env.local file.",
  );
}

const convexUrl: string = envUrl;

/** HTTP actions, auth routes and web pages are served from the Convex site URL. */
export const backendSiteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

/** The app's one Convex client; authenticated by BackendProvider in the root layout. */
export const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});

/** Stateless client for code outside React (background tasks), authenticated with a Convex JWT. */
export function createBackendHttpClient(jwt: string) {
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(jwt);
  return client;
}
