import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing EXPO_PUBLIC_CONVEX_URL. Add it to your .env.local file.",
  );
}

/** The app's one Convex client; authenticated by ConvexBetterAuthProvider in the root layout. */
export const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
});
